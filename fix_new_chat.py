import os

def fix_new_chat_modal():
    path = 'src/components/NewChatModal.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        c = f.read()
    
    old_show = '<Show when={props.isOpen}>\n      <div class="fixed inset-0 z-50 flex items-center justify-center">\n        <div class="absolute inset-0 bg-xuanqing/80 backdrop-blur-md" onClick={() => !roomResult() && !props.creating && props.onClose()} />\n        <div class="relative w-full max-w-5xl h-[90vh] bg-mist border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">'
    
    new_show = '<div class={`fixed inset-0 z-50 flex items-center justify-center transition-all duration-300 ease-out ${props.isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>\n        <div class="absolute inset-0 bg-xuanqing/80 backdrop-blur-md" onClick={() => !roomResult() && !props.creating && props.onClose()} />\n        <div class={`relative w-full max-w-5xl h-[90vh] bg-mist border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ease-out delay-75 ${props.isOpen ? "scale-100 translate-y-0 opacity-100" : "scale-[0.98] translate-y-4 opacity-0"}`}>'
    
    c = c.replace(old_show, new_show)
    c = c.replace('</div>\n      </div>\n    </Show>', '</div>\n      </div>')
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(c)

fix_new_chat_modal()
print("done2")
