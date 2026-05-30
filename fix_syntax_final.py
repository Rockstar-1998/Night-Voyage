import os
import glob

for filepath in glob.glob('src/components/*.tsx'):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # We want to find cases where we have:
    #   }})<newline>  options={[
    # and replace with:
    #   }}<newline>  options={[
    content = content.replace('}})\n  options={[', '}}\n  options={[')
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
