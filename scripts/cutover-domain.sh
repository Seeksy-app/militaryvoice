#!/usr/bin/env bash
# Move the site's own address from militaryvoice.ai to militaryvoices.ai.
#
#   scripts/cutover-domain.sh web     # links, share cards, OG tags, redirects: after Vercel serves the new domain
#   scripts/cutover-domain.sh mail    # from-addresses: after Resend verifies the new domain and Workspace has it
#
# The old domain keeps working throughout: pages redirect to the new one,
# and /api stays answered on both, so webhooks, the YouTube callback, QR
# codes, /go and /find links, and every email already sent keep working.
set -euo pipefail
cd "$(dirname "$0")/.."
FILES=$(grep -rIl "militaryvoice\.ai" client/src server shared api client/index.html 2>/dev/null || true)

case "${1:-}" in
  web)
    # URLs only: www.militaryvoice.ai, militaryvoice.ai/..., and the bare site
    # name in links. Email addresses are left for the mail step.
    for f in $FILES; do
      perl -pi -e 's#https?://(www\.)?militaryvoice\.ai#https://www.militaryvoices.ai#g; s#(?<![@\w.])militaryvoice\.ai/#militaryvoices.ai/#g' "$f"
    done
    python3 - <<'PY'
import json
p = "vercel.json"; j = json.load(open(p))
rule = {"source": "/((?!api/|s/|og/|go/).*)", "has": [{"type": "host", "value": "(www\\.)?militaryvoice\\.ai"}], "destination": "https://www.militaryvoices.ai/$1", "permanent": True}
reds = j.setdefault("redirects", [])
if not any(r.get("destination", "").startswith("https://www.militaryvoices.ai") for r in reds):
    reds.insert(0, rule)
json.dump(j, open(p, "w"), indent=2); open(p, "a").write("\n")
PY
    echo "web cutover applied. Also set PUBLIC_ORIGIN=https://www.militaryvoices.ai on Vercel."
    ;;
  mail)
    for f in $FILES; do
      perl -pi -e 's#([a-z]+)\@militaryvoice\.ai#$1\@militaryvoices.ai#g' "$f"
    done
    echo "mail cutover applied: from-addresses now @militaryvoices.ai."
    ;;
  *)
    echo "usage: $0 web|mail"; exit 1 ;;
esac
grep -rIn "militaryvoice\.ai" client/src server shared api client/index.html | wc -l | xargs echo "old-domain mentions left:"
