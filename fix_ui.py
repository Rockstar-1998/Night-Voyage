import os
import re

def fix_message_options():
    path = 'src/components/MessageFormatRenderer.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replacing the flex-wrap gap-2 layout with vertical list layout
    old_wrapper = '<div class="flex flex-wrap gap-2 mt-3">'
    new_wrapper = '<div class="flex flex-col gap-2 mt-4">'
    content = content.replace(old_wrapper, new_wrapper)

    old_button = '''<button
                    class="px-4 py-2 bg-accent/20 border border-accent/30 rounded-lg text-sm text-mist-solid hover:bg-accent/30 transition-colors"
                    onClick={() => {
                      props.onChoiceSelect?.(optKey, optValue);
                    }}
                  >
                    <span class="text-accent/80 font-semibold mr-1">{optKey}</span>
                    <span class="text-mist-solid/70">{optValue}</span>
                  </button>'''
    
    new_button = '''<button
                    class="group flex flex-col md:flex-row items-start md:items-center gap-4 px-5 py-3.5 bg-xuanqing/40 border border-white/5 hover:border-accent/40 hover:bg-white/[0.04] transition-all text-left rounded-none w-full relative overflow-hidden"
                    onClick={() => {
                      props.onChoiceSelect?.(optKey, optValue);
                    }}
                  >
                    <div class="absolute inset-y-0 left-0 w-[2px] bg-white/10 group-hover:bg-accent transition-colors"></div>
                    <span class="text-accent font-black tracking-widest uppercase text-xs w-4 shrink-0 mt-0.5">{optKey}</span>
                    <span class="text-mist-solid/80 text-sm leading-relaxed">{optValue}</span>
                  </button>'''
    
    content = content.replace(old_button, new_button)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def fix_app_toggle():
    path = 'src/App.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    old_btn = '''<button
                          onClick={props.toggleFocusMode}
                          class="absolute -left-12 top-1/2 -translate-y-1/2 z-40 p-2.5 rounded-l-2xl bg-accent text-white shadow-xl border border-white/10 opacity-40 hover:opacity-100 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"'''
    
    new_btn = '''<button
                          onClick={props.toggleFocusMode}
                          class="fixed top-[45%] right-0 -translate-y-1/2 z-30 bg-black/40 hover:bg-black/60 text-mist-solid/60 hover:text-accent p-2 rounded-l-xl border-l border-y border-white/10 backdrop-blur-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"'''
    
    content = content.replace(old_btn, new_btn)

    old_btn2 = '''<button
              onClick={props.toggleFocusMode}
              class="absolute -left-12 top-1/2 -translate-y-1/2 z-40 p-2.5 rounded-l-2xl bg-accent text-white shadow-xl border border-white/10 opacity-40 hover:opacity-100 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"'''
    new_btn2 = '''<button
              onClick={props.toggleFocusMode}
              class="fixed top-[45%] right-0 -translate-y-1/2 z-30 bg-black/40 hover:bg-black/60 text-mist-solid/60 hover:text-accent p-2 rounded-l-xl border-l border-y border-white/10 backdrop-blur-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"'''
    
    content = content.replace(old_btn2, new_btn2)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def fix_right_drawer():
    path = 'src/components/RightDrawer.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # fix button
    old_btn = '''<button
        onClick={toggleDrawer}
        class={`fixed top-1/2 right-0 -translate-y-1/2 z-30 bg-accent/80 hover:bg-accent text-white p-1.5 py-4 rounded-l-2xl shadow-[0_0_20px_rgba(0,0,0,0.3)] border-l border-y border-white/10 backdrop-blur-md transition-all hover:pr-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${isOpen() ? 'translate-x-full opacity-0' : ''}`}'''
    
    new_btn = '''<button
        onClick={toggleDrawer}
        class={`fixed top-[55%] right-0 -translate-y-1/2 z-30 bg-black/40 hover:bg-black/60 text-mist-solid/60 hover:text-accent p-2 rounded-l-xl border-l border-y border-white/10 backdrop-blur-md transition-all hover:pr-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${isOpen() ? 'translate-x-full opacity-0' : ''}`}'''
    
    content = content.replace(old_btn, new_btn)

    # fix overlay
    old_overlay = '''<Show when={isOpen()}>
        <div
          class="fixed inset-0 bg-xuanqing/40 backdrop-blur-sm z-40 transition-opacity"
          onClick={toggleDrawer}
        />
      </Show>'''
    
    new_overlay = '''<div
          class={`fixed inset-0 bg-xuanqing/40 z-40 transition-all duration-300 ease-out ${isOpen() ? 'opacity-100 backdrop-blur-sm pointer-events-auto' : 'opacity-0 backdrop-blur-none pointer-events-none'}`}
          onClick={toggleDrawer}
        />'''
    
    content = content.replace(old_overlay, new_overlay)

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def fix_modals():
    # CharacterSidebar
    path = 'src/components/CharacterSidebar.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        c = f.read()
    old_show = '<Show when={isModalOpen()}>\n        <div class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">\n          <div class="w-full max-w-2xl bg-xuanqing border-y-2 border-white/10 p-8 shadow-2xl animate-in zoom-in-95 duration-300">'
    new_show = '<div class={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm transition-all duration-300 ease-out ${isModalOpen() ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>\n          <div class={`w-full max-w-2xl bg-xuanqing border-y-2 border-white/10 p-8 shadow-2xl transition-all duration-300 ease-out delay-75 ${isModalOpen() ? "scale-100 translate-y-0 opacity-100" : "scale-[0.98] translate-y-4 opacity-0"}`}>'
    c = c.replace(old_show, new_show)
    
    # replace the closing tag of this show
    c = c.replace('</form>\n          </div>\n        </div>\n      </Show>', '</form>\n          </div>\n        </div>')
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

    # SchemaConfigPanel
    path = 'src/components/SchemaConfigPanel.tsx'
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace('<Show when={props.isOpen}>\n      <div class="fixed inset-y-0 right-0 w-[460px] bg-xuanqing/95 backdrop-blur-2xl border-l border-white/5 z-[900] shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">', 
                  '<div class={`fixed inset-y-0 right-0 w-[460px] bg-xuanqing/95 backdrop-blur-2xl border-l border-white/5 z-[900] shadow-2xl flex flex-col transition-all duration-300 ease-out ${props.isOpen ? "translate-x-0" : "translate-x-full"}`}>')
    c = c.replace('</div>\n      </div>\n    </Show>', '</div>\n      </div>')
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

    # JoinRoomModal
    path = 'src/components/JoinRoomModal.tsx'
    with open(path, 'r', encoding='utf-8') as f: c = f.read()
    c = c.replace('<Show when={props.isOpen}>\n      <div class="fixed inset-0 z-[2000] flex flex-col bg-xuanqing/98 backdrop-blur-3xl animate-in fade-in duration-500">',
                  '<div class={`fixed inset-0 z-[2000] flex flex-col bg-xuanqing/98 backdrop-blur-3xl transition-all duration-300 ease-out ${props.isOpen ? "opacity-100 pointer-events-auto scale-100" : "opacity-0 pointer-events-none scale-105"}`}>')
    c = c.replace('</div>\n      </div>\n    </Show>', '</div>\n      </div>')
    with open(path, 'w', encoding='utf-8') as f: f.write(c)

fix_message_options()
fix_app_toggle()
fix_right_drawer()
fix_modals()

print("done")
