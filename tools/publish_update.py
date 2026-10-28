#!/usr/bin/env python3
"""Inaandika taarifa ya toleo jipya kwenye Supabase (jedwali gpsa_release: safu "app-android" na "app-windows").
Inaendeshwa na GitHub Actions baada ya release kutolewa. Vifaa vyote (APK/EXE) vinasoma safu hizi na kujisasisha.

Inahitaji (env): TAG, BUILD, VERSION, RELEASE_REPO, OWNER_EMAIL, OWNER_PASSWORD
Hiari:           SUPABASE_URL / SUPABASE_ANON_KEY (la sivyo zinasomwa kutoka extensions/gpsa-extension/config.js)
                 ASSET_BASE_URL (la sivyo https://github.com/<RELEASE_REPO>/releases/download/<TAG>)
Inatumia akaunti ya OWNER (iliyo kwenye gpsa_owners) - hakuna service_role key."""
import json, os, re, subprocess, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def need(k):
    v = os.environ.get(k, '').strip()
    if not v:
        sys.exit(f'Env {k} haipo.')
    return v


TAG, BUILD, VERSION = need('TAG'), int(need('BUILD')), need('VERSION')
REPO, EMAIL, PASSWORD = need('RELEASE_REPO'), need('OWNER_EMAIL'), os.environ.get('OWNER_PASSWORD', '')
if not PASSWORD:
    sys.exit('Env OWNER_PASSWORD haipo (weka kwenye GitHub > Settings > Secrets).')

cfg = open(os.path.join(ROOT, 'extensions', 'gpsa-extension', 'config.js'), encoding='utf-8').read()
def cfgval(k):
    m = re.search(k + r"\s*:\s*'([^']*)'", cfg)
    return m.group(1).strip() if m else ''
SB = (os.environ.get('SUPABASE_URL') or cfgval('supabaseUrl')).rstrip('/')
ANON = os.environ.get('SUPABASE_ANON_KEY') or cfgval('supabaseAnonKey')
if not SB or not ANON:
    sys.exit('supabaseUrl / supabaseAnonKey hazipo kwenye config.js.')
BASE = (os.environ.get('ASSET_BASE_URL') or f'https://github.com/{REPO}/releases/download/{TAG}').rstrip('/')


def http(method, url, headers=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    h = {'user-agent': 'gimis-charms-publisher'}
    h.update(headers or {})
    if data is not None:
        h['content-type'] = 'application/json'
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def asset_size(url):
    """Hakikisha faili lipo na linapakuliwa bila kuingia (repo/releases lazima ziwe public). Inarudisha ukubwa wake."""
    st, h, _ = http('GET', url, {'range': 'bytes=0-0'})
    if st not in (200, 206):
        return None
    cr = h.get('Content-Range') or h.get('content-range') or ''
    m = re.search(r'/(\d+)\s*$', cr)
    if m:
        return int(m.group(1))
    return int(h.get('Content-Length') or h.get('content-length') or 0)


# ---- notes: commit messages za karibuni ----
try:
    log = subprocess.run(['git', 'log', '-8', '--pretty=format:- %s'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
except Exception:
    log = ''
NOTES = log[:1500]

# ---- tafuta faili zilizopo kwenye release ----
android_files = {'phone': 'Gimis-Charms-Simu-universal.apk', 'tablet': 'Gimis-Charms-Tablet-universal.apk'}
windows_files = {a: f'Gimis-Charms-Setup-{VERSION}-{a}.exe' for a in ('x64', 'ia32', 'arm64')}

def collect(files):
    urls, sizes = {}, {}
    for k, name in files.items():
        u = f'{BASE}/{name}'
        s = asset_size(u)
        if s:
            urls[k], sizes[k] = u, s
            print(f'  OK   {k}: {name} ({s} bytes)')
        else:
            print(f'  SKIP {k}: {name} haipatikani')
    return urls, sizes

print('Android:'); a_urls, a_sizes = collect(android_files)
print('Windows:'); w_urls, w_sizes = collect(windows_files)
if not a_urls and not w_urls:
    sys.exit('Hakuna faili hata moja linalopakuliwa. Ikiwa repo ni private, release haiwezi kupakuliwa na vifaa - tazama AUTO-UPDATE.md (RELEASE_REPO).')

# ---- ingia kama owner ----
st, _, body = http('POST', f'{SB}/auth/v1/token?grant_type=password', {'apikey': ANON}, {'email': EMAIL, 'password': PASSWORD})
if st != 200:
    sys.exit(f'Owner sign-in imeshindikana ({st}): {body.decode()[:300]}')
TOKEN = json.loads(body)['access_token']
H = {'apikey': ANON, 'authorization': 'Bearer ' + TOKEN}


def publish(row_id, urls, sizes):
    if not urls:
        print(f'{row_id}: hakuna faili, imerukwa.')
        return
    st, _, b = http('GET', f'{SB}/rest/v1/gpsa_release?select=data&id=eq.{row_id}&limit=1', H)
    if st != 200:
        sys.exit(f'{row_id}: kusoma kumeshindikana ({st}): {b.decode()[:300]}')
    rows = json.loads(b)
    old = rows[0]['data'] if rows else {}
    data = {
        'version': VERSION, 'build': BUILD, 'tag': TAG, 'notes': NOTES,
        'urls': urls, 'sizes': sizes,
        'pageUrl': f'https://github.com/{REPO}/releases/tag/{TAG}',
        'publishedAt': int(__import__('time').time() * 1000), 'publishedBy': EMAIL,
    }
    # 'minBuild' na 'force' ulizoweka mkono kwenye Supabase zinabaki (hazifutwi na kila build)
    for k in ('minBuild', 'force'):
        if k in old:
            data[k] = old[k]
    if old.get('build', 0) and int(old['build']) >= BUILD:
        sys.exit(f'{row_id}: build {BUILD} si mpya kuliko iliyopo ({old["build"]}). Hakuna kilichobadilishwa.')
    st, _, b = http('POST', f'{SB}/rest/v1/gpsa_release?on_conflict=id',
                    dict(H, prefer='resolution=merge-duplicates,return=minimal'), {'id': row_id, 'data': data})
    if st not in (200, 201, 204):
        sys.exit(f'{row_id}: kuandika kumeshindikana ({st}): {b.decode()[:300]}')
    print(f'OK {row_id} -> v{VERSION} build {BUILD}')


publish('app-android', a_urls, a_sizes)
publish('app-windows', w_urls, w_sizes)
