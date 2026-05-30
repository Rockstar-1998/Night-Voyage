import re
with open('diff.txt', 'r', encoding='utf-8') as f:
    lines = f.readlines()
for line in lines:
    if line.startswith('-') and 'onChange=' in line:
        print(line.strip())
