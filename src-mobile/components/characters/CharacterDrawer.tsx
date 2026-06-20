import { Component, createSignal, createEffect, For, Show, createMemo } from 'solid-js';
import { Save, Trash2, X, Upload, Plus, ChevronDown, ChevronUp } from 'lucide-solid';
import { 
  CharacterCard, 
  CharacterCardType,
  CharacterBaseSectionInput,
  CharacterBaseSectionKey,
  ApiProviderSummary,
  WorldBookSummary,
  importManagedImageFile,
  resolveImageSrc,
  characterCardsCreate,
  characterCardsUpdate,
  characterCardsDelete
} from '../../../src/lib/backend';

interface CharacterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  character: CharacterCard | null;
  cardType: CharacterCardType; // used when creating a new character
  worldBooks: WorldBookSummary[];
  providers: ApiProviderSummary[];
  onRefresh: () => Promise<void>;
}

interface CharacterBaseSectionFormState {
  sectionKey: CharacterBaseSectionKey | string;
  title: string;
  content: string;
  sortOrder: string;
}

const BASE_SECTION_OPTIONS = [
  { value: 'identity', label: '身份底座' },
  { value: 'persona', label: '人格底座' },
  { value: 'background', label: '背景事实' },
  { value: 'rules', label: '长期规则' },
  { value: 'custom', label: '自定义' },
];

const createEmptyBaseSection = (): CharacterBaseSectionFormState => ({
  sectionKey: 'identity',
  title: '',
  content: '',
  sortOrder: '',
});

export const CharacterDrawer: Component<CharacterDrawerProps> = (props) => {
  const [name, setName] = createSignal('');
  const [imagePath, setImagePath] = createSignal('');
  const [tags, setTags] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [baseSections, setBaseSections] = createSignal<CharacterBaseSectionFormState[]>([]);
  const [firstMessages, setFirstMessages] = createSignal<string[]>([]);
  const [defaultWorldBookId, setDefaultWorldBookId] = createSignal('');
  const [defaultProviderId, setDefaultProviderId] = createSignal('');
  
  const [isSaving, setIsSaving] = createSignal(false);
  const [uploadingImage, setUploadingImage] = createSignal(false);
  
  // Accordion state
  const [expandedSection, setExpandedSection] = createSignal<'base' | 'desc' | 'firstMsg' | 'bindings' | null>('base');

  let fileInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.isOpen) {
      if (props.character) {
        setName(props.character.name);
        setImagePath(props.character.imagePath || '');
        setTags(props.character.tags.join(' ')); // Space or comma separated
        setDescription(props.character.description || '');
        setBaseSections(props.character.baseSections.map((section) => ({
          sectionKey: section.sectionKey || 'custom',
          title: section.title ?? '',
          content: section.content,
          sortOrder: String(section.sortOrder ?? ''),
        })));
        setFirstMessages([...props.character.firstMessages]);
        setDefaultWorldBookId(props.character.defaultWorldBookId ? String(props.character.defaultWorldBookId) : '');
        setDefaultProviderId(props.character.defaultProviderId ? String(props.character.defaultProviderId) : '');
      } else {
        setName('');
        setImagePath('');
        setTags('');
        setDescription('');
        setBaseSections([]);
        setFirstMessages([]);
        setDefaultWorldBookId('');
        setDefaultProviderId('');
      }
    }
  });

  const previewSrc = createMemo(() =>
    resolveImageSrc(
      imagePath(),
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name() || 'character')}`,
    ),
  );

  const importImage = async (file?: File) => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const imported = await importManagedImageFile(file);
      setImagePath(imported.storedPath);
    } catch (e) {
      window.alert('上传失败');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!name().trim()) {
      window.alert('角色名称不能为空');
      return;
    }
    
    setIsSaving(true);
    try {
      const payload = {
        cardType: props.character ? (props.character.cardType as CharacterCardType) : props.cardType,
        name: name().trim(),
        imagePath: imagePath().trim() || undefined,
        description: description().trim(),
        tags: tags().split(/[\s,]+/).map(t => t.trim()).filter(Boolean),
        baseSections: baseSections()
          .map((section, index) => ({
            sectionKey: section.sectionKey as CharacterBaseSectionKey,
            title: section.title.trim() || undefined,
            content: section.content.trim(),
            sortOrder: section.sortOrder.trim() ? Number(section.sortOrder) : index,
          }))
          .filter((section) => section.content.length > 0),
        firstMessages: firstMessages().filter((msg) => msg.trim().length > 0),
        defaultWorldBookId: defaultWorldBookId() ? Number(defaultWorldBookId()) : undefined,
        defaultProviderId: defaultProviderId() ? Number(defaultProviderId()) : undefined,
      };
      
      if (props.character) {
        await characterCardsUpdate({ id: props.character.id, ...payload });
      } else {
        await characterCardsCreate(payload);
      }
      
      await props.onRefresh();
      props.onClose();
    } catch (e) {
      window.alert(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!props.character) return;
    if (!window.confirm(`确定要删除角色「${props.character.name}」吗？`)) return;
    
    setIsSaving(true);
    try {
      await characterCardsDelete(props.character.id);
      await props.onRefresh();
      props.onClose();
    } catch (e) {
      window.alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleAccordion = (section: 'base' | 'desc' | 'firstMsg' | 'bindings') => {
    if (expandedSection() === section) {
      setExpandedSection(null);
    } else {
      setExpandedSection(section);
    }
  };

  return (
    <div class={`fixed inset-0 z-[3000] flex flex-col justify-end transition-all duration-300 ease-out ${props.isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <div 
        class={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${props.isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={props.onClose}
      />

      <div class={`relative w-full bg-xuanqing border-t border-white/5 rounded-t-3xl h-[92vh] flex flex-col transition-transform duration-300 ease-out safe-area-bottom ${props.isOpen ? 'translate-y-0' : 'translate-y-full'}`}>
        
        <div class="w-full flex justify-center pt-4 pb-2 shrink-0">
          <div class="w-12 h-1.5 bg-white/20 rounded-full" />
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pb-24 pt-2 flex flex-col gap-6 relative z-0">
          
          <div class="flex items-center justify-between">
             <h2 class="text-xl font-bold text-white">{props.character ? '编辑角色卡' : '新建角色卡'}</h2>
             <button onClick={props.onClose} class="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-mist-solid/60 hover:text-white transition-colors">
               <X size={16} />
             </button>
          </div>

          <div class="flex gap-4 items-start border border-white/5 bg-white/5 rounded-2xl p-4">
             <div class="relative group cursor-pointer shrink-0" onClick={() => fileInputRef?.click()}>
                <img src={previewSrc()} alt="avatar" class="w-20 h-20 rounded-xl object-cover bg-black/40 border border-white/10" />
                <div class="absolute inset-0 bg-black/50 rounded-xl flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Upload size={20} class="text-white mb-1" />
                  <span class="text-[9px] text-white">上传头像</span>
                </div>
                <Show when={uploadingImage()}>
                  <div class="absolute inset-0 bg-black/70 rounded-xl flex items-center justify-center">
                    <span class="text-xs text-white animate-pulse">上传中</span>
                  </div>
                </Show>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  class="hidden"
                  onChange={(e) => void importImage(e.currentTarget.files?.[0])}
                />
             </div>
             
             <div class="flex-1 flex flex-col gap-3 justify-center">
               <input
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  placeholder="角色名称"
                  class="w-full bg-transparent border-b border-white/10 py-1 text-base text-white focus:outline-none focus:border-accent transition-colors font-bold"
               />
               <input
                  value={tags()}
                  onInput={(e) => setTags(e.currentTarget.value)}
                  placeholder="添加标签 (空格或逗号分隔)"
                  class="w-full bg-transparent border-b border-white/10 py-1 text-xs text-mist-solid focus:outline-none focus:border-accent transition-colors"
               />
             </div>
          </div>

          <div class="flex flex-col gap-3">
            
            {/* Base Sections Accordion */}
            <div class="bg-white/5 rounded-2xl border border-white/5 overflow-hidden">
              <button 
                onClick={() => toggleAccordion('base')}
                class="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <div class="w-2 h-2 rounded-full bg-accent" />
                  <span class="text-sm font-bold text-white">基础层设定 (Base Sections)</span>
                </div>
                <div class="flex items-center gap-2 text-mist-solid/40">
                  <span class="text-xs">{baseSections().length} 个段落</span>
                  {expandedSection() === 'base' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </button>
              
              <Show when={expandedSection() === 'base'}>
                <div class="p-4 pt-0 flex flex-col gap-4 border-t border-white/5">
                  <For each={baseSections()}>
                    {(section, idx) => (
                      <div class="bg-black/20 rounded-xl p-3 border border-white/5 flex flex-col gap-3">
                         <div class="flex justify-between items-center gap-2">
                           <select
                              value={section.sectionKey}
                              onChange={(e) => {
                                const next = [...baseSections()];
                                next[idx()] = { ...next[idx()], sectionKey: e.currentTarget.value };
                                setBaseSections(next);
                              }}
                              class="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent"
                           >
                              <For each={BASE_SECTION_OPTIONS}>
                                {(opt) => <option value={opt.value} class="bg-xuanqing">{opt.label}</option>}
                              </For>
                           </select>
                           <button 
                             onClick={() => {
                               const next = baseSections().filter((_, i) => i !== idx());
                               setBaseSections(next);
                             }}
                             class="text-mist-solid/40 hover:text-red-400 p-1"
                           >
                             <Trash2 size={14} />
                           </button>
                         </div>
                         <input
                            value={section.title}
                            onInput={(e) => {
                              const next = [...baseSections()];
                              next[idx()] = { ...next[idx()], title: e.currentTarget.value };
                              setBaseSections(next);
                            }}
                            placeholder="段落标题 (可选)"
                            class="bg-transparent border-b border-white/10 py-1 text-xs text-white focus:outline-none focus:border-accent"
                         />
                         <textarea
                            value={section.content}
                            onInput={(e) => {
                              const next = [...baseSections()];
                              next[idx()] = { ...next[idx()], content: e.currentTarget.value };
                              setBaseSections(next);
                            }}
                            placeholder="输入正文内容..."
                            class="bg-transparent border border-white/10 rounded-lg p-2 text-xs text-mist-solid focus:outline-none focus:border-accent min-h-[80px] custom-scrollbar"
                         />
                      </div>
                    )}
                  </For>
                  <button 
                    onClick={() => setBaseSections([...baseSections(), createEmptyBaseSection()])}
                    class="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-dashed border-white/20 text-xs text-accent hover:bg-accent/10 transition-colors"
                  >
                    <Plus size={14} />
                    新增段落
                  </button>
                </div>
              </Show>
            </div>

            {/* Description Accordion */}
            <div class="bg-white/5 rounded-2xl border border-white/5 overflow-hidden">
              <button 
                onClick={() => toggleAccordion('desc')}
                class="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <div class="w-2 h-2 rounded-full bg-mist-solid/50" />
                  <span class="text-sm font-bold text-white">兼容描述 / 回退文本</span>
                </div>
                {expandedSection() === 'desc' ? <ChevronUp size={16} class="text-mist-solid/40" /> : <ChevronDown size={16} class="text-mist-solid/40" />}
              </button>
              
              <Show when={expandedSection() === 'desc'}>
                <div class="p-4 pt-0 border-t border-white/5">
                  <textarea
                    value={description()}
                    onInput={(e) => setDescription(e.currentTarget.value)}
                    placeholder="当基础层未配置时，将回退使用此文本..."
                    class="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-xs text-mist-solid focus:outline-none focus:border-accent min-h-[100px] custom-scrollbar"
                  />
                </div>
              </Show>
            </div>

            {/* First Messages Accordion */}
            <Show when={props.cardType === 'npc' || (props.character && props.character.cardType === 'npc')}>
              <div class="bg-white/5 rounded-2xl border border-white/5 overflow-hidden">
                <button 
                  onClick={() => toggleAccordion('firstMsg')}
                class="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <div class="w-2 h-2 rounded-full bg-green-500" />
                  <span class="text-sm font-bold text-white">开局白 (First Messages)</span>
                </div>
                <div class="flex items-center gap-2 text-mist-solid/40">
                  <span class="text-xs">{firstMessages().length} 条</span>
                  {expandedSection() === 'firstMsg' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </button>
              
              <Show when={expandedSection() === 'firstMsg'}>
                <div class="p-4 pt-0 flex flex-col gap-3 border-t border-white/5">
                  <For each={firstMessages()}>
                    {(msg, idx) => (
                      <div class="flex gap-2 items-start">
                        <textarea
                          value={msg}
                          onInput={(e) => {
                            const next = [...firstMessages()];
                            next[idx()] = e.currentTarget.value;
                            setFirstMessages(next);
                          }}
                          placeholder={`第 ${idx() + 1} 条开局白...`}
                          class="flex-1 bg-black/20 border border-white/10 rounded-xl p-3 text-xs text-mist-solid focus:outline-none focus:border-accent min-h-[80px] custom-scrollbar"
                        />
                        <button 
                          onClick={() => {
                            const next = firstMessages().filter((_, i) => i !== idx());
                            setFirstMessages(next);
                          }}
                          class="mt-2 text-mist-solid/40 hover:text-red-400 p-1"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </For>
                  <button 
                    onClick={() => setFirstMessages([...firstMessages(), ''])}
                    class="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-dashed border-white/20 text-xs text-accent hover:bg-accent/10 transition-colors"
                  >
                    <Plus size={14} />
                    新增开局白
                  </button>
                </div>
              </Show>
            </div>
            </Show>

            {/* Bindings Accordion */}
            <Show when={props.cardType === 'npc' || (props.character && props.character.cardType === 'npc')}>
              <div class="bg-white/5 rounded-2xl border border-white/5 overflow-hidden">
                <button 
                  onClick={() => toggleAccordion('bindings')}
                  class="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-2 h-2 rounded-full bg-purple-500" />
                    <span class="text-sm font-bold text-white">高级绑定</span>
                  </div>
                  {expandedSection() === 'bindings' ? <ChevronUp size={16} class="text-mist-solid/40" /> : <ChevronDown size={16} class="text-mist-solid/40" />}
                </button>
                
                <Show when={expandedSection() === 'bindings'}>
                  <div class="p-4 pt-0 flex flex-col gap-4 border-t border-white/5">
                    <div class="flex flex-col gap-1.5">
                      <label class="text-[10px] text-mist-solid/50">关联世界书</label>
                      <select
                        value={defaultWorldBookId()}
                        onChange={(e) => setDefaultWorldBookId(e.currentTarget.value)}
                        class="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-accent"
                      >
                        <option value="" class="bg-xuanqing">无关联</option>
                        <For each={props.worldBooks}>
                          {(wb) => <option value={wb.id} class="bg-xuanqing">{wb.title}</option>}
                        </For>
                      </select>
                    </div>
                    <div class="flex flex-col gap-1.5">
                      <label class="text-[10px] text-mist-solid/50">默认模型 API</label>
                      <select
                        value={defaultProviderId()}
                        onChange={(e) => setDefaultProviderId(e.currentTarget.value)}
                        class="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-accent"
                      >
                        <option value="" class="bg-xuanqing">跟随系统默认</option>
                        <For each={props.providers}>
                          {(provider) => <option value={provider.id} class="bg-xuanqing">{provider.name}</option>}
                        </For>
                      </select>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>

          </div>
        </div>

        {/* Action Buttons */}
        <div class="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-xuanqing via-xuanqing/95 to-transparent z-20 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-3">
          <Show when={props.character}>
            <button
              onClick={handleDelete}
              disabled={isSaving()}
              class="w-12 h-12 shrink-0 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <Trash2 size={20} />
            </button>
          </Show>
          <button
            onClick={handleSave}
            disabled={isSaving()}
            class="flex-1 h-12 rounded-xl bg-accent text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-accent/90 transition-colors shadow-[0_4px_15px_rgba(58,109,140,0.4)] disabled:opacity-50"
          >
            <Save size={18} />
            {isSaving() ? '保存中...' : '保存角色卡'}
          </button>
        </div>
      </div>
    </div>
  );
};
