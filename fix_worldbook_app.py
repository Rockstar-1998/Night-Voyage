import re
with open('src/App.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

old_str = """                <Match when={workspaceId === 'worldbook'}>
                  <Show
                    when={selectedWorldBookId() !== null}
                    fallback={
                      <WorldBookSidebar
                        onLoadEntries={(id) => {
                          setSelectedWorldBookId(id);
                        }}
                      />
                    }
                  >
                    <WorldBookEntryArea
                      bookId={selectedWorldBookId()!}
                      onBack={() => setSelectedWorldBookId(null)}
                    />
                  </Show>
                </Match>"""
new_str = """                <Match when={workspaceId === 'worldbook'}>
                  <WorkspaceTransitionStage
                    activeWorkspace={selectedWorldBookId() !== null ? 'entry' : 'list'}
                    paneIds={['list', 'entry']}
                  >
                    {(subId) => (
                      <Switch fallback={<div />}>
                        <Match when={subId === 'list'}>
                          <WorldBookSidebar
                            onLoadEntries={(id) => {
                              setSelectedWorldBookId(id);
                            }}
                          />
                        </Match>
                        <Match when={subId === 'entry'}>
                          <WorldBookEntryArea
                            bookId={selectedWorldBookId()!}
                            onBack={() => setSelectedWorldBookId(null)}
                          />
                        </Match>
                      </Switch>
                    )}
                  </WorkspaceTransitionStage>
                </Match>"""

c = c.replace(old_str, new_str)
with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print("done")
