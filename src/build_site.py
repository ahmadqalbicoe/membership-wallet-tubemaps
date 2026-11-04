# Rebuilds site/index.html from src/template.html + src/map.json (tube map layout) + src/extra.json
# (student benefits + retailers/affiliate directory).  Run: python3 src/build_site.py
import os
here = os.path.dirname(os.path.abspath(__file__))
t = open(os.path.join(here, 'template.html'), encoding='utf-8').read()
d = open(os.path.join(here, 'map.json'), encoding='utf-8').read().replace('</', '<\\/')
x = open(os.path.join(here, 'extra.json'), encoding='utf-8').read().replace('</', '<\\/')
out = os.path.join(here, '..', 'site', 'index.html')
open(out, 'w', encoding='utf-8').write(t.replace('__DATA__', d, 1).replace('__EXTRA__', x, 1))
print('wrote', os.path.normpath(out))
