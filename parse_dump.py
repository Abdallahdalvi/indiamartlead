import re
with open('indiamart_dump.html', encoding='utf-8') as f:
    html = f.read()

headers = re.findall(r'col-id="([^"]+)".*?<span[^>]*>(.*?)</span>', html)
print("Headers:")
for h in headers:
    print(f" - {h[0]}: {h[1]}")
    
# Let's also grab the first data row
row = re.search(r'row-index="0".*?aria-label="Press SPACE to select this row."(.*?)</div></div></div></div></div>', html)
if row:
    print("\nFirst row HTML:")
    print(row.group(1)[:1500])
