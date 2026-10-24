"""Stamps a new site version before publishing.

Usage:  py scripts/release.py
Writes version.json (version + list of site files) and APP_VERSION in js/app.js.
When a visitor's browser still has an older version cached, the site notices the
new version.json, re-downloads these files and reloads itself.
"""
import glob
import json
import os
import re
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

version = time.strftime("%Y%m%d-%H%M%S")
files = sorted(
    f.replace(os.sep, "/")
    for pattern in ["index.html", "css/*.css", "js/**/*.js", "data/*.json", "data/academic/*.json", "img/*.png"]
    for f in glob.glob(pattern, recursive=True)
)
with open("version.json", "w", encoding="utf-8") as fh:
    json.dump({"v": version, "files": files}, fh, indent=1)

app = open("js/app.js", encoding="utf-8").read()
app = re.sub(r'export const APP_VERSION = "[^"]*";', f'export const APP_VERSION = "{version}";', app)
open("js/app.js", "w", encoding="utf-8").write(app)
print("version", version, "-", len(files), "files")
