#!/usr/bin/env python3
"""Fill the skill template with sample content, the same way Claude does.

Run: python3 scripts/make_study_demo.py  ->  writes demo/study.html
"""
import os

HERE = os.path.dirname(__file__)
TEMPLATE = os.path.join(HERE, "..", "skill", "study-highlighter", "assets", "template.html")
OUT = os.path.join(HERE, "..", "demo", "study.html")

CONTENT = """<h1>The Krebs cycle</h1>
<p>The <strong>Krebs cycle</strong> (also called the citric acid cycle) is the central step of cellular respiration. It takes place in the <em>mitochondrial matrix</em> and turns acetyl-CoA into carbon dioxide while it captures energy.</p>
<h2>Key steps</h2>
<ol>
<li>Acetyl-CoA joins oxaloacetate to make citrate.</li>
<li>Citrate changes to isocitrate.</li>
<li>Isocitrate is oxidized to α-ketoglutarate, and one CO₂ is released.</li>
<li>α-Ketoglutarate is oxidized to succinyl-CoA, and a second CO₂ is released.</li>
</ol>
<h2>What one turn produces</h2>
<table>
<thead><tr><th>Product</th><th>Per turn</th><th>Per glucose</th></tr></thead>
<tbody>
<tr><td>NADH</td><td>3</td><td>6</td></tr>
<tr><td>FADH₂</td><td>1</td><td>2</td></tr>
<tr><td>GTP (or ATP)</td><td>1</td><td>2</td></tr>
<tr><td>CO₂</td><td>2</td><td>4</td></tr>
</tbody>
</table>
<p>Remember: the cycle itself makes little ATP directly. Its main job is to load <code>NADH</code> and <code>FADH₂</code> with electrons for the electron transport chain.</p>"""

with open(TEMPLATE, encoding="utf-8") as f:
    html = f.read()
html = html.replace("{{TITLE}}", "The Krebs cycle").replace("{{DOC_ID}}", "krebs-cycle-demo")
html = html.replace("<!-- CONTENT -->", CONTENT)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)
print("wrote", os.path.normpath(OUT))
