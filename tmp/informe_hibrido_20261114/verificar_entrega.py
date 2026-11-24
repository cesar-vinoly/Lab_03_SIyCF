from pathlib import Path
import json, hashlib, re, collections, zipfile
root=Path(r'C:\Users\cesar\Desktop\Lab_03_SIyCF\informe_pid_hibrido_ieee')
provenance=json.loads((root/'datos/procedencia.json').read_text(encoding='utf-8'))
def blob(b):
    return hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
for f in provenance['files']:
    path=root/'datos'/f['path']; data=path.read_bytes()
    candidates=[data, data.rstrip(b'\r\n'), data.rstrip(b'\r\n')+b'\n',
                data.replace(b'\r\n',b'\n'), data.replace(b'\r\n',b'\n').rstrip(b'\n')+b'\n']
    exact=next((b for b in candidates if blob(b)==f['sha']),None)
    assert exact is not None, (f['path'],len(data),f['size'],blob(data),f['sha'])
    if exact!=data:path.write_bytes(exact)
tex=(root/'main.tex').read_text(encoding='utf-8')
assert '\ufffd' not in tex
assert tex.count('begin{document}')==1 and tex.count('end{document}')==1
stack=[]
for action,env in re.findall(r'\\(begin|end)\{([^}]+)\}',tex):
    if action=='begin': stack.append(env)
    else: assert stack and stack.pop()==env,(action,env,stack)
assert not stack
depth=0
for token in re.findall(r'(?<!\\)[{}]',tex):
    depth+=1 if token=='{' else -1
    assert depth>=0
assert depth==0
labels=re.findall(r'\\label\{([^}]+)\}',tex)
assert len(labels)==len(set(labels))
refs=re.findall(r'\\(?:eqref|ref)\{([^}]+)\}',tex)
assert set(refs)<=set(labels),set(refs)-set(labels)
bib=re.findall(r'\\bibitem\{([^}]+)\}',tex)
cites=[key for group in re.findall(r'\\cite\{([^}]+)\}',tex) for key in group.split(',')]
assert set(cites)<=set(bib)
for name in re.findall(r'\\includegraphics(?:\[[^]]*\])?\{([^}]+)\}',tex):
    assert (root/'figuras'/name).is_file(),name
for name in re.findall(r'\\input\{([^}]+)\}',tex):
    assert (root/name).is_file(),name
print(json.dumps({'raw_files_exact_git_hash':len(provenance['files']),'unique_labels':len(labels),'references':len(refs),'bibliography':len(bib),'figures':len(list((root/'figuras').glob('*.pdf'))),'structural_latex_checks':'passed','pdf_report_compilation':'not verified'},indent=2))

