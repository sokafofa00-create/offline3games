#!/bin/bash
# Read-only source probe: prints context around identifiers in the game bundles to the run summary.
M=com.plato.android/files/g/5470e3f408f5869a8a853c580878c101400906a5/game/main.js
B=com.plato.android/files/g/ae765a3baaa799266c501acf673b10a5b0000e92/game/main.js
{
echo "## probe"
for pat in setCustomPlugins; do
  echo "### $pat in monsters (count: $(grep -o "$pat" $M | wc -l))"
  node -e '
const t=require("fs").readFileSync(process.argv[1],"utf8");const p=process.argv[2];let i=-1,n=0;
while((i=t.indexOf(p,i+1))>=0&&n<4){console.log("```\n"+t.slice(Math.max(0,i-500),i+250)+"\n```");n++}' $M $pat
done
echo "### plato.* members used by monsters (unique)"
grep -o 'plato\.[A-Za-z_]*' $M | sort | uniq -c | sort -rn | head -60
echo "### plato members defined in bridge"
grep -o '^    [A-Za-z_]*[:(]' web/runtime/plato-bridge.js | tr -d ' :(' | sort -u | tr '\n' ' '
echo; echo "### ls assets dir"; ls com.plato.android/files/assets | head; ls com.plato.android/files/assets | wc -l
} >> "$GITHUB_STEP_SUMMARY"
