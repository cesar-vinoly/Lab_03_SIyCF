from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib,json
root=Path(r'C:\Users\cesar\Desktop\Lab_03_SIyCF\informe_pid_hibrido_ieee')
out=root.parent/'informe_control_hibrido_latex.zip'
files=sorted(p for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix not in {'.pyc','.aux','.out','.toc','.synctex','.fls','.fdb_latexmk'})
with ZipFile(out,'w',compression=ZIP_DEFLATED,compresslevel=9) as z:
    for p in files: z.write(p,str(p.relative_to(root)).replace('\\','/'))
with ZipFile(out) as z:
    assert z.testzip() is None
    assert 'main.tex' in z.namelist()
    assert len([x for x in z.namelist() if x.startswith('figuras/') and x.endswith('.pdf')])==8
print(json.dumps({'zip':str(out),'files':len(files),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()},indent=2))

