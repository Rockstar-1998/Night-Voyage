import re
with open('src/components/SettingsArea.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# Replace the wrapper around WorkspaceTransitionStage
c = c.replace('<div class="flex-1 flex flex-col h-full bg-transparent overflow-y-auto custom-scrollbar">\n      <div class="max-w-5xl mx-auto w-full px-8 py-16">\n        <WorkspaceTransitionStage activeWorkspace={props.activeCategory} paneIds={[\'api\', \'appearance\']}>',
              '<div class="flex-1 flex flex-col h-full bg-transparent overflow-hidden">\n        <WorkspaceTransitionStage activeWorkspace={props.activeCategory} paneIds={[\'api\', \'appearance\']}>')

# For 'api' category
c = c.replace('<Show when={categoryId === \'api\'}>\n          <div class="space-y-10">',
              '<Show when={categoryId === \'api\'}>\n          <div class="h-full w-full overflow-y-auto custom-scrollbar">\n            <div class="max-w-5xl mx-auto w-full px-8 py-16 space-y-10">')

# We need to close the extra div for 'api'. It ends before <Show when={categoryId === 'appearance'}>
c = c.replace('</div>\n            </Show>\n            <Show when={categoryId === \'appearance\'}>',
              '</div>\n            </div>\n            </Show>\n            <Show when={categoryId === \'appearance\'}>')

# For 'appearance' category
c = c.replace('<Show when={categoryId === \'appearance\'}>\n          <div class="space-y-10">',
              '<Show when={categoryId === \'appearance\'}>\n          <div class="h-full w-full overflow-y-auto custom-scrollbar">\n            <div class="max-w-5xl mx-auto w-full px-8 py-16 space-y-10">')

# We need to close the extra div for 'appearance'. It ends at the very end of the file.
c = c.replace('</div>\n            </Show>\n          </>}\n        </WorkspaceTransitionStage>\n      </div>\n    </div>',
              '</div>\n            </div>\n            </Show>\n          </>}\n        </WorkspaceTransitionStage>\n    </div>')

with open('src/components/SettingsArea.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print("done")
