"""Bridge the registered fold-2 checkpoint to the existing slipp-science implementation.

The original RF/docking environment stays separate from the UV-managed deep runtime.
Only the explicitly registered, SHA256-verified checkpoint is deserialized.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

MODEL_ID = 'saprot-egnn-fold2'
MODEL_NAME = 'SaProt–EGNN · asymmetric fold 2'


def sha(path):
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def config_path():
    root = Path.home()/'Library/Application Support' if sys.platform == 'darwin' else Path(os.environ.get('XDG_DATA_HOME', str(Path.home()/'.local/share')))
    return root/'science.slipp.studio/geometric-runtime.json'


def configuration():
    path = config_path()
    if not path.is_file():
        raise ValueError('SaProt–EGNN is not configured. Run scripts/setup-geometric.sh with the slipp-science directory and checkpoint.')
    config = json.loads(path.read_text())
    for key in ('python', 'checkpoint', 'foldseek'):
        if not Path(config[key]).is_file():
            raise ValueError(f'SaProt–EGNN {key} is missing. Rerun scripts/setup-geometric.sh.')
    # Detect drift in the checkpoint, encoder, graph contract, or feature implementation.
    for path, expected in config['hashes'].items():
        if not Path(path).is_file() or sha(path) != expected:
            raise ValueError(f'SaProt–EGNN registered file changed: {path}. Rerun setup to register the intended files.')
    return config


def predict(pockets, mapping, pdb, directory, cache, cancel, cpu):
    config = configuration()
    reverse = {(v['chain'], v['seq'], v['insertionCode']): f'{c}:{n}' for (c,n),v in mapping.items()}
    rows = [dict(pocket_residues=[reverse[(r['chain'],r['seq'],r['insertionCode'])] for r in p['residues']],
                 alpha_sphere_coords=[s['center'] for s in p['geometry']['alphaSpheres']],
                 **{f['name']:f['value'] for f in p['features']}) for p in pockets]
    source = directory/'geometric-input.json'
    output = directory/'geometric-output.json'
    source.write_text(json.dumps(dict(pockets=pockets, rows=rows, pdb=str(pdb), cache=str(cache/'saprot'), cpu=cpu)))
    started = time.monotonic()
    with (directory/'geometric.log').open('w') as log:
        process = subprocess.Popen([config['python'], str(Path(__file__).resolve()), str(source), str(output)],
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while process.poll() is None:
                if cancel.exists(): raise InterruptedError('SaProt–EGNN inference canceled.')
                if time.monotonic()-started > 900: raise TimeoutError('SaProt–EGNN inference exceeded 15 minutes.')
                time.sleep(.1)
        finally:
            if process.poll() is None:
                try: os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError: pass
            process.wait()
    if cancel.exists(): raise InterruptedError('SaProt–EGNN inference canceled.')
    if not output.is_file(): raise RuntimeError('SaProt–EGNN failed: '+(directory/'geometric.log').read_text()[-3000:])
    result = json.loads(output.read_text())
    if result.get('error'): raise RuntimeError(result['error'])
    if process.returncode: raise RuntimeError('SaProt–EGNN worker failed.')
    return result


def load_checkpoint(config):
    import numpy as np
    import torch
    from slipp.data.lipid_classes import LIPID_CLASS_NAMES, LIPID_TAXONOMY_VERSION
    from slipp.data.features import FEATURE_SETS
    from slipp.models.graph_model import ResidueCavityEGNN
    checkpoint = torch.load(config['checkpoint'], map_location='cpu', weights_only=False)
    if (checkpoint.get('format') != 'slipp_residue_cavity_multitask_v3' or checkpoint.get('fold') != 2
        or tuple(checkpoint.get('class_names', ())) != LIPID_CLASS_NAMES
        or checkpoint.get('lipid_taxonomy', {}).get('version') != LIPID_TAXONOMY_VERSION
        or checkpoint['feature_columns'] != FEATURE_SETS['v_sterol_graphlite']):
        raise ValueError('Checkpoint does not match the fold-2 graph and canonical taxonomy contract.')
    graph = json.loads(Path(config['graphMetadata']).read_text())
    if graph['feature_columns'] != checkpoint['feature_columns'] or (graph['max_residues'],graph['max_spheres']) != (48,48):
        raise ValueError('Graph representation does not match this checkpoint.')
    model = ResidueCavityEGNN(**checkpoint['model_config'])
    model.load_state_dict(checkpoint['state_dict'], strict=True)
    for prefix, size in [('global',146), ('saprot',960)]:
        mean, std = checkpoint[prefix+'_mean'], checkpoint[prefix+'_std']
        if mean.shape != (size,) or std.shape != (size,) or not np.isfinite(mean).all() or not np.isfinite(std).all() or (std<=0).any():
            raise ValueError('Invalid checkpoint feature standardizer.')
    return checkpoint, model.eval()


def score(input, config):
    sys.path.insert(0, str(Path(config['scienceRoot'])/'src'))
    import numpy as np
    import polars as pl
    import torch
    from transformers import AutoModelForMaskedLM, AutoTokenizer
    from slipp.data.features import build_feature_table, ensure_feature_columns
    from slipp.data.graph_data import _structure_residue_map, _build_pocket_graph
    from slipp.data.saprot_features import _foldseek_sequences, _structure_chain_keys, _foldseek_to_residue_keys, _embed_chains

    torch.set_num_threads(max(1,min(int(input['cpu']),8)))
    checkpoint, model = load_checkpoint(config)
    pockets = input['pockets']
    identity = hashlib.sha256((json.dumps(config['hashes'],sort_keys=True)+sha(__file__)).encode()).hexdigest()
    result = dict(pockets=pockets, model=dict(name=MODEL_NAME, version=f'fold2-{sha(config["checkpoint"])[:12]}',
        classes=['non-lipid','lipid'], calibration='Single asymmetric-loss CV fold (2), seed 44. Raw sigmoid scores; no ensemble or post-hoc calibration. Eight conditional lipid-class outputs are independent multilabel scores, not a distribution.'),
        provenance=f'SaProt–EGNN asymmetric fold 2; checkpoint SHA256 {sha(config["checkpoint"])}; registered feature/encoder manifest SHA256 {identity}; canonical taxonomy {checkpoint["lipid_taxonomy"]["version"]}. SaProt-35M mean/max pooling; 146 global descriptors; 48 residue + 48 cavity nodes. CPU float32 inference; training-cache float16 graph/pool quantization retained. Foldseek {config["foldseekVersion"]} (training used {config["trainingFoldseekVersion"]}).')
    if not pockets: return result
    pdb = Path(input['pdb'])
    # Reuse the upstream graph and descriptor builders, including their feature order.
    rows = pl.DataFrame([dict(row, file_path=pdb.name, pocket_id=i) for i,row in enumerate(input['rows'])])
    features = ensure_feature_columns(build_feature_table(rows, pdb.parent, workers=1), checkpoint['feature_columns']).sort('pocket_id')
    global_x = features.select(checkpoint['feature_columns']).to_numpy().astype(np.float32)
    if not np.isfinite(global_x).all(): raise ValueError('Non-finite geometric model descriptors.')
    residue_map = _structure_residue_map(pdb)
    graphs = [_build_pocket_graph(residue_map,row['pocket_residues'],row['alpha_sphere_coords'],48,48) for row in input['rows']]
    if any(not mask[:48].any() for _,_,mask in graphs):
        raise ValueError('A candidate has no valid residue graph; geometric inference cannot score it.')

    # Cache the expensive chain encoder by coordinates AND registered implementation/weights.
    cache = Path(input['cache']); cache.mkdir(parents=True,exist_ok=True)
    key = hashlib.sha256(pdb.read_bytes()+identity.encode()).hexdigest()
    pooled_path = cache/(key+'.npz')
    chains = _structure_chain_keys(pdb)
    cache_hit = pooled_path.exists()
    if cache_hit:
        with np.load(pooled_path, allow_pickle=False) as saved:
            embeddings = {chain:saved[chain] for chain in saved.files}
    else:
        sequences = _foldseek_sequences(Path(config['foldseek']),pdb)
        tokenizer = AutoTokenizer.from_pretrained(config['saprot'], local_files_only=True)
        masked_lm = AutoModelForMaskedLM.from_pretrained(config['saprot'], local_files_only=True)
        backbone = getattr(masked_lm,'esm',masked_lm.base_model).eval()
        if backbone.config.hidden_size != 480: raise ValueError('Expected the SaProt-35M encoder.')
        embeddings = _embed_chains(sequences,tokenizer,backbone,torch.device('cpu'),torch,batch_size=2)
        # Persist aligned residues, not Foldseek positions, so cache hits need no Foldseek run.
        aligned = {}
        for chain, values in embeddings.items():
            if chain not in chains: continue
            aa, keys = chains[chain]
            mapping = _foldseek_to_residue_keys(sequences[chain][0],aa,keys)
            for position, (_,seq) in mapping.items():
                if position<len(values): aligned[f'{chain}:{seq}']=values[position]
        embeddings = aligned
        temporary = pooled_path.with_suffix('.tmp')
        with temporary.open('wb') as handle: np.savez_compressed(handle,**embeddings)
        temporary.replace(pooled_path)
    saprot = []
    coverage = []
    for row in input['rows']:
        values = [embeddings[r] for r in row['pocket_residues'] if r in embeddings]
        if not values: raise ValueError('A pocket has no SaProt residue coverage. No geometric scores were saved.')
        values = np.asarray(values,dtype=np.float32)
        coverage.append(f'{len(values)}/{len(row["pocket_residues"])}')
        saprot.append(np.concatenate([values.mean(0),values.max(0)]).astype(np.float16).astype(np.float32))
    def standardize(values, prefix):
        return torch.from_numpy(np.nan_to_num((values-checkpoint[prefix+'_mean'])/checkpoint[prefix+'_std'],nan=0,posinf=0,neginf=0))
    binaries, classes = [], []
    # Bound graph memory regardless of the number of fpocket candidates.
    with torch.inference_mode():
        for start in range(0,len(pockets),32):
            batch=graphs[start:start+32]
            binary, lipid=model(torch.from_numpy(np.stack([g[0] for g in batch]).astype(np.int64)),
                torch.from_numpy(np.stack([g[1] for g in batch]).astype(np.float16).astype(np.float32)),
                torch.from_numpy(np.stack([g[2] for g in batch])),
                standardize(global_x[start:start+32],'global'),standardize(np.asarray(saprot[start:start+32]),'saprot'),return_lipid_logits=True)
            binaries.extend(binary.sigmoid().tolist()); classes.extend(lipid.sigmoid().tolist())
    for i,(p,binary,lipid) in enumerate(zip(pockets,binaries,classes,strict=True)):
        if not np.isfinite([binary,*lipid]).all(): raise ValueError('Non-finite geometric model output.')
        p['prediction']=dict(label='lipid',probability=binary,probabilities={'non-lipid':1-binary,'lipid':binary},
            lipidClasses=dict(taxonomyVersion=checkpoint['lipid_taxonomy']['version'],scores=dict(zip(checkpoint['class_names'],lipid,strict=True))))
        p['features']=[dict(name=name,value=float(value),unit=None) for name,value in zip(checkpoint['feature_columns'],global_x[i],strict=True)]
    result['provenance']+=f' SaProt lining-residue coverage in fpocket order: {coverage}. Chain-embedding cache hit: {cache_hit}.'
    return result


if __name__ == '__main__':
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result=score(json.loads(Path(sys.argv[1]).read_text()),configuration())
        Path(sys.argv[2]).write_text(json.dumps(result,allow_nan=False))
    except Exception as error:
        Path(sys.argv[2]).write_text(json.dumps({'error':f'SaProt–EGNN: {error}'}))
        raise
