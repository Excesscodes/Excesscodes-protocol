# Dev-time tool. Samples brand and reference rasters with k-means, snaps each
# centroid to the nearest real pixel (x, y), writes tokens/palette.json.
import json, numpy as np
from PIL import Image
from sklearn.cluster import KMeans

def centroids(path, k, alpha_only=False):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    h, w = a.shape[:2]
    flat = a.reshape(-1, 4)
    keep = np.where(flat[:, 3] > 200)[0] if alpha_only else np.arange(len(flat))
    rng = np.random.RandomState(7)
    pick = rng.choice(keep, min(80000, len(keep)), replace=False)
    km = KMeans(k, n_init=4, random_state=7).fit(flat[pick, :3])
    out = []
    n = np.bincount(km.labels_)
    for c, cnt in zip(km.cluster_centers_, n):
        d = ((flat[keep, :3].astype(float) - c) ** 2).sum(1)
        j = keep[d.argmin()]
        y, x = divmod(int(j), w)
        r, g, b = (int(v) for v in flat[j, :3])
        out.append({"centroid": [round(float(v), 1) for v in c], "share": round(cnt / n.sum(), 4),
                    "hex": "#%02x%02x%02x" % (r, g, b), "x": x, "y": y})
    return out

src = {
  "logo_png": "brand/LOGO EXCESS PNG.png",
  "logo_alpha": "brand/LOGO EXCESS PNG...png",
  "slide3": "reference/EXCESS 3.jpg.jpeg",
  "slide1": "reference/EXCESS 1.jpg.jpeg",
  "cover": "reference/SAMPUL EXCESS JPG.jpg.jpeg",
}
c = {"logo_png": centroids(src["logo_png"], 6),
     "logo_alpha": centroids(src["logo_alpha"], 4, True),
     "slide3": centroids(src["slide3"], 12),
     "slide1": centroids(src["slide1"], 8),
     "cover": centroids(src["cover"], 8)}

def pick(name, key, cond, why, score):
    cands = [dict(e, file=src[key]) for e in c[key] if cond(e["centroid"])]
    best = max(cands, key=score)
    return {"name": name, "hex": best["hex"], "file": best["file"], "x": best["x"], "y": best["y"],
            "centroid": best["centroid"], "share": best["share"], "role": why}

lum = lambda v: 0.2126*v[0]+0.7152*v[1]+0.0722*v[2]
tokens = [
  pick("ground", "logo_png", lambda v: lum(v) < 60, "page ground, dominant logo field", lambda e: e["share"]),
  pick("ground-deep", "slide1", lambda v: lum(v) < 40, "deepest field, slide ground", lambda e: e["share"]),
  pick("surface", "cover", lambda v: lum(v) < 60 and v[1] > v[0], "raised surface, cover field", lambda e: -e["share"] if e["share"] > 0.3 else -9),
  pick("cream", "logo_alpha", lambda v: lum(v) > 200, "mark fill, logo ink", lambda e: e["share"]),
  pick("mint", "slide3", lambda v: v[1] > 200 and v[1] - v[0] > 80, "accent, pill outline on slide", lambda e: e["centroid"][1]),
  pick("sage", "slide1", lambda v: 150 < lum(v) < 215 and v[1] >= v[0], "secondary text", lambda e: e["share"]),
  pick("contour", "cover", lambda v: 40 < lum(v) < 90 and v[1] > v[0] + 10, "dashed contour line", lambda e: e["share"]),
]
json.dump({"method": "k-means (sklearn, seed 7), centroid snapped to the nearest real pixel coordinate",
           "tokens": tokens, "clusters": c}, open("tokens/palette.json", "w"), indent=1)
for t in tokens: print(t["name"], t["hex"], t["file"], (t["x"], t["y"]))
