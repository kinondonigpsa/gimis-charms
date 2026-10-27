#!/usr/bin/env python3
"""Prepares every extension in /extensions for Gimis Charms (Firefox engine, Android).

Put an extension in /extensions as a folder (with manifest.json) or as a .zip.  For each one this script:
  * converts the Chrome manifest to the Firefox flavour (background service_worker -> background scripts,
    adds the Firefox add-on id, removes keys Firefox does not know),
  * copies the files to app/src/main/assets/extensions/<name>/,
  * writes assets/extensions/index.json (what the app installs at start-up).
Your original files are never modified.  Run:  python3 tools/prepare_extensions.py
"""
import json, os, re, shutil, sys, tempfile, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'extensions')
DST = os.path.join(ROOT, 'app', 'src', 'main', 'assets', 'extensions')
warnings = []

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') or 'extension'

def find_manifest_dir(base):
    if os.path.isfile(os.path.join(base, 'manifest.json')):
        return base
    for d in sorted(os.listdir(base)):
        p = os.path.join(base, d)
        if os.path.isdir(p) and os.path.isfile(os.path.join(p, 'manifest.json')):
            return p
    return None

def bg_scripts(srcdir, main):
    """service_worker + the files it loads with importScripts(), in a working order."""
    try:
        code = open(os.path.join(srcdir, main), encoding='utf-8').read()
    except OSError:
        return [main]
    first_decl = re.search(r'^(?:const|let|class)\s', code, re.M)
    limit = first_decl.start() if first_decl else 0
    pre, post = [], []
    for m in re.finditer(r'importScripts\(([^)]*)\)', code):
        for f in re.findall(r'[\'"]([^\'"]+\.js)[\'"]', m.group(1)):
            if os.path.isfile(os.path.join(srcdir, f)):
                (pre if m.start() < limit else post).append(f)
    out = []
    for f in pre + [main] + post:
        if f not in out:
            out.append(f)
    return out

def convert(m, srcdir, name):
    out = dict(m)
    ext_id = ((m.get('browser_specific_settings') or {}).get('gecko') or {}).get('id') or (slug(name) + '@gpsa-browser.local')
    bss = dict(m.get('browser_specific_settings') or {})
    gecko = dict(bss.get('gecko') or {})
    gecko['id'] = ext_id
    gecko.setdefault('strict_min_version', '128.0')
    bss['gecko'] = gecko
    out['browser_specific_settings'] = bss
    bg = m.get('background')
    if isinstance(bg, dict) and 'service_worker' in bg:
        out['background'] = {'scripts': bg_scripts(srcdir, bg['service_worker'])}
    if 'sandbox' in out:
        del out['sandbox']
        warnings.append(f'{name}: "sandbox" pages are not supported by Firefox. Features that run code in a sandbox page (e.g. the elapsAI code interpreter) will not work.')
    csp = out.get('content_security_policy')
    if isinstance(csp, dict) and 'sandbox' in csp:
        csp = {k: v for k, v in csp.items() if k != 'sandbox'}
        if csp: out['content_security_policy'] = csp
        else: del out['content_security_policy']
    for k in ('minimum_chrome_version', 'update_url', 'key', 'externally_connectable'):
        out.pop(k, None)
    return out, ext_id

def main():
    if not os.path.isdir(SRC):
        sys.exit('No /extensions folder.')
    shutil.rmtree(DST, ignore_errors=True)
    os.makedirs(DST)
    index, used = [], set()
    for entry in sorted(os.listdir(SRC)):
        p = os.path.join(SRC, entry)
        tmp = None
        if entry.lower().endswith('.zip'):
            tmp = tempfile.mkdtemp()
            with zipfile.ZipFile(p) as z:
                z.extractall(tmp)
            p = tmp
        elif not os.path.isdir(p):
            continue
        src = find_manifest_dir(p)
        if not src:
            print(f'SKIP {entry}: no manifest.json found'); continue
        m = json.load(open(os.path.join(src, 'manifest.json'), encoding='utf-8-sig'))
        name = slug(os.path.splitext(entry)[0])
        base, n = name, 2
        while name in used:
            name = f'{base}-{n}'; n += 1
        used.add(name)
        out, ext_id = convert(m, src, name)
        dest = os.path.join(DST, name)
        shutil.copytree(src, dest)
        json.dump(out, open(os.path.join(dest, 'manifest.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
        index.append({'dir': name, 'id': ext_id, 'name': m.get('name', name), 'version': m.get('version', '')})
        print(f'OK   {entry} -> {name}  ({m.get("name")} v{m.get("version")}, id {ext_id})')
        if tmp: shutil.rmtree(tmp, ignore_errors=True)
    json.dump(index, open(os.path.join(DST, 'index.json'), 'w', encoding='utf-8'), indent=1)
    for w in warnings:
        print('NOTE', w)
    if not index:
        sys.exit('No extensions prepared.')

if __name__ == '__main__':
    main()
