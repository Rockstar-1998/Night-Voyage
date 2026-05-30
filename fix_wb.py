import re

with open('src/components/WorldBookSidebar.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

old_modal = """      <Show when={isModalOpen()}>
        <div class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div class="w-full max-w-2xl bg-xuanqing border-y-2 border-white/10 p-8 shadow-2xl animate-in zoom-in-95 duration-300">"""

new_modal = """      <div class={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm transition-all duration-300 ease-out ${isModalOpen() ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
          <div class={`w-full max-w-2xl bg-xuanqing border-y-2 border-white/10 p-8 shadow-2xl transition-all duration-300 ease-out delay-75 ${isModalOpen() ? "scale-100 translate-y-0 opacity-100" : "scale-[0.98] translate-y-4 opacity-0"}`}>"""

c = c.replace(old_modal, new_modal)

old_close = """          </div>
        </div>
      </Show>
    </>
  );"""

new_close = """          </div>
      </div>
    </>
  );"""
c = c.replace(old_close, new_close)

with open('src/components/WorldBookSidebar.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print("done worldbook")
