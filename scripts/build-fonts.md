# Regenerating `server/assets/fonts.ts`

The share cards draw their type as vector outlines, because the deployment
runtime has no fonts installed — `<text>` in an SVG came out as empty boxes on
Vercel while looking perfect locally on macOS. `server/assets/fonts.ts` holds
Inter, subset to Latin and base64-encoded so it travels inside the bundle.

Inter is SIL Open Font License 1.1 (https://github.com/rsms/inter), which
permits bundling and redistribution. Don't swap in a font without checking its
licence allows the same — General Sans, the site's headline face, does not.

To rebuild (needs `fonttools`: `pip3 install fonttools`):

```bash
# 1. Current static TTFs, straight from Google Fonts
curl -s -A "Mozilla/4.0" "https://fonts.googleapis.com/css2?family=Inter:wght@400;700" \
  | grep -o "https://[^)]*\.ttf"
# download both URLs as inter-400.ttf and inter-700.ttf

# 2. Subset to the glyphs a podcast name might plausibly need
UNI="U+0020-007E,U+00A0-00FF,U+2018-201D,U+2013,U+2014,U+2022,U+2026,U+00B7,U+0100-017F"
for w in 400 700; do
  python3 -m fontTools.subset inter-$w.ttf --unicodes="$UNI" \
    --layout-features='' --no-hinting --output-file=i-$w.ttf
done

# 3. Base64 the two files into server/assets/fonts.ts as
#    INTER_REGULAR_B64 and INTER_BOLD_B64.
```

Roughly 23 KB each subset, ~31 KB each encoded. Keep it that way: the whole
point is that it ships with the function.
