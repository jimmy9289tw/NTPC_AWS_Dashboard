"""僅匯出已在本機信任、且實際驗證政府來源的公開根憑證，不含私鑰。"""
from pathlib import Path
import hashlib,json,socket,ssl,urllib.parse
ROOT=Path(__file__).resolve().parent
registry=json.loads((ROOT/'fetch-registry.json').read_bytes())
hosts=sorted({urllib.parse.urlsplit(r['url']).hostname for r in registry['files']})
trusted={hashlib.sha256(cert).hexdigest() for cert,encoding,trust in ssl.enum_certificates('ROOT') if encoding=='x509_asn'}
context=ssl.create_default_context();roots={};checks=[]
for host in hosts:
    with socket.create_connection((host,443),timeout=30) as connection:
        with context.wrap_socket(connection,server_hostname=host) as secure:
            chain=secure._sslobj.get_verified_chain();root=chain[-1];pem=root.public_bytes()
            der=ssl.PEM_cert_to_DER_cert(pem);digest=hashlib.sha256(der).hexdigest()
            if digest not in trusted:raise ValueError('根憑證不在既有系統信任清單：'+host)
            for certificate in chain[1:]:
                ca_pem=certificate.public_bytes();ca_digest=hashlib.sha256(ssl.PEM_cert_to_DER_cert(ca_pem)).hexdigest();roots[ca_digest]=ca_pem
            checks.append({'host':host,'verified':True,'root_sha256':digest,'root':root.get_info(),'ca_chain':[c.get_info() for c in chain[1:]],'leaf_issuer':secure.getpeercert().get('issuer')})
(ROOT/'government-source-roots.pem').write_text('\n'.join(roots.values()),encoding='ascii')
(ROOT/'government-source-roots.json').write_text(json.dumps({'public_certificates_only':True,'private_keys':False,'verification_disabled':False,'certificates':len(roots),'hosts':checks},ensure_ascii=False,indent=2,default=str),encoding='utf-8')
print(json.dumps({'hosts':len(hosts),'roots':len(roots),'status':'TLS_VERIFIED'},ensure_ascii=False))
