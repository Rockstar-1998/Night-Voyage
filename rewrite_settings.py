import re

with open('src/components/SettingsArea.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# Add imports for Switch and Match
c = c.replace("import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';",
              "import { Component, For, Show, Switch, Match, createEffect, createMemo, createSignal } from 'solid-js';")

c = c.replace("""        <WorkspaceTransitionStage activeWorkspace={props.activeCategory} paneIds={['api', 'appearance']}>
          {(categoryId) => <>
            <Show when={categoryId === 'api'}>""", """        <WorkspaceTransitionStage activeWorkspace={props.activeCategory} paneIds={['api', 'appearance']}>
          {(categoryId) => <Switch fallback={<div />}>
            <Match when={categoryId === 'api'}>""")

c = c.replace("""            </Show>
            <Show when={categoryId === 'appearance'}>""", """            </Match>
            <Match when={categoryId === 'appearance'}>""")

c = c.replace("""            </Show>

        <Show when={props.activeCategory !== 'api' && props.activeCategory !== 'appearance'}>
          <div class="h-[60vh] flex flex-col items-center justify-center text-mist-solid/20">
            <p class="text-xl font-bold mb-2">正在设计中</p>
            <p class="text-sm italic">此功能模块暂未接入真实后端</p>
          </div>
        </Show>
          </>}""", """            </Match>

            <Match when={categoryId !== 'api' && categoryId !== 'appearance'}>
              <div class="h-[60vh] flex flex-col items-center justify-center text-mist-solid/20">
                <p class="text-xl font-bold mb-2">正在设计中</p>
                <p class="text-sm italic">此功能模块暂未接入真实后端</p>
              </div>
            </Match>
          </Switch>}""")

with open('src/components/SettingsArea.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print("done")
