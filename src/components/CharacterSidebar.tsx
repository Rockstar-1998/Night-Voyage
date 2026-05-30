import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { Select } from './ui/Select';
import { Pencil, Plus, Save, Search, Trash2, Upload, User, Users, X } from '../lib/icons';
import { IconButton } from './ui/IconButton';
import { WorkspaceTransitionStage } from './WorkspaceTransitionStage';
import {
  importManagedImageFile,
  resolveImageSrc,
  type ApiProviderSummary,
  type CharacterBaseSectionInput,
  type CharacterBaseSectionKey,
  type CharacterCard,
  type CharacterCardType,
  type WorldBookSummary,
} from '../lib/backend';

interface CharacterSidebarProps {
  npcCharacters: CharacterCard[];
  playerCharacters: CharacterCard[];
  worldBooks: WorldBookSummary[];
  providers: ApiProviderSummary[];
  loading?: boolean;
  onCreateCharacter: (payload: {
    cardType: CharacterCardType;
    name: string;
    imagePath?: string;
    description: string;
    tags: string[];
    baseSections?: CharacterBaseSectionInput[];
    firstMessages?: string[];
    defaultWorldBookId?: number;
    defaultProviderId?: number;
  }) => Promise<void> | void;
  onUpdateCharacter: (payload: {
    id: number;
    cardType: CharacterCardType;
    name: string;
    imagePath?: string;
    description: string;
    tags: string[];
    baseSections?: CharacterBaseSectionInput[];
    firstMessages?: string[];
    defaultWorldBookId?: number;
    defaultProviderId?: number;
  }) => Promise<void> | void;
  onDeleteCharacter: (id: number) => Promise<void> | void;
}

interface CharacterBaseSectionFormState {
  sectionKey: CharacterBaseSectionKey;
  title: string;
  content: string;
  sortOrder: string;
}

interface CharacterFormState {
  name: string;
  imagePath: string;
  description: string;
  tags: string;
  baseSections: CharacterBaseSectionFormState[];
  firstMessages: string[];
  defaultWorldBookId: string;
  defaultProviderId: string;
}

const BASE_SECTION_OPTIONS: Array<{ value: CharacterBaseSectionKey; label: string }> = [
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

const EMPTY_FORM: CharacterFormState = {
  name: '',
  imagePath: '',
  description: '',
  tags: '',
  baseSections: [],
  firstMessages: [],
  defaultWorldBookId: '',
  defaultProviderId: '',
};

export const CharacterSidebar: Component<CharacterSidebarProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<CharacterCardType>('npc');
  const [search, setSearch] = createSignal('');
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [formData, setFormData] = createSignal<CharacterFormState>(EMPTY_FORM);
  const [uploadingImage, setUploadingImage] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;

  const currentCharacters = createMemo(() =>
    activeTab() === 'player' ? props.playerCharacters : props.npcCharacters,
  );

  const filteredCharacters = createMemo(() => {
    const query = search().trim().toLowerCase();
    if (!query) return currentCharacters();
    return currentCharacters().filter((character) =>
      [
        character.name,
        character.description,
        character.tags.join(' '),
        character.baseSections.map((section) => `${section.title ?? ''} ${section.content}`).join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  });

  const openModal = (character?: CharacterCard) => {
    if (character) {
      setEditingId(character.id);
      setFormData({
        name: character.name,
        imagePath: character.imagePath ?? '',
        description: character.description,
        tags: character.tags.join(', '),
        baseSections: character.baseSections.map((section) => ({
          sectionKey: (section.sectionKey as CharacterBaseSectionKey) || 'custom',
          title: section.title ?? '',
          content: section.content,
          sortOrder: String(section.sortOrder ?? ''),
        })),
        firstMessages: [...character.firstMessages],
        defaultWorldBookId: character.defaultWorldBookId ? String(character.defaultWorldBookId) : '',
        defaultProviderId: character.defaultProviderId ? String(character.defaultProviderId) : '',
      });
    } else {
      setEditingId(null);
      setFormData({ ...EMPTY_FORM });
    }
    setIsModalOpen(true);
  };

  const importImage = async (file?: File) => {
    if (!file) return;
    setUploadingImage(true);
    try {
      const imported = await importManagedImageFile(file);
      setFormData({ ...formData(), imagePath: imported.storedPath });
    } finally {
      setUploadingImage(false);
    }
  };

  const previewSrc = createMemo(() =>
    resolveImageSrc(
      formData().imagePath,
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(formData().name || 'character')}`,
    ),
  );

  const handleSave = async () => {
    const data = formData();
    const payload = {
      cardType: activeTab(),
      name: data.name.trim() || '未命名角色',
      imagePath: data.imagePath.trim() || undefined,
      description: data.description.trim(),
      tags: data.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      baseSections: data.baseSections
        .map((section, index) => ({
          sectionKey: section.sectionKey,
          title: section.title.trim() || undefined,
          content: section.content.trim(),
          sortOrder: section.sortOrder.trim() ? Number(section.sortOrder) : index,
        }))
        .filter((section) => section.content.length > 0),
      firstMessages: data.firstMessages.filter((message) => message.trim().length > 0),
      defaultWorldBookId: data.defaultWorldBookId ? Number(data.defaultWorldBookId) : undefined,
      defaultProviderId: data.defaultProviderId ? Number(data.defaultProviderId) : undefined,
    };

    if (editingId() != null) {
      await props.onUpdateCharacter({ id: editingId()!, ...payload });
    } else {
      await props.onCreateCharacter(payload);
    }

    setIsModalOpen(false);
  };

  return (
    <div class="w-full flex flex-col bg-transparent h-full relative pt-10">
      <div class="p-8 flex flex-col gap-6">
        <div class="flex items-center justify-between">
          <h1 class="text-3xl font-black text-white tracking-tighter uppercase italic">角色展示柜</h1>
          <IconButton onClick={() => openModal()} label="添加角色" tone="accent" size="lg">
            <Plus size={18} />
          </IconButton>
        </div>

        <div class="flex items-center justify-between gap-4 border-b border-white/10 pb-4 mb-4">
          <div>
            <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">视图切换</div>
            <div class="text-sm text-mist-solid/40 mt-1">当前：{activeTab() === 'npc' ? '对话角色' : '我的设定'}</div>
          </div>
          <div class="flex items-center gap-2">
            <IconButton
              onClick={() => setActiveTab('npc')}
              label="切换到对话角色"
              tone={activeTab() === 'npc' ? 'accent' : 'neutral'}
              active={activeTab() === 'npc'}
            >
              <Users size={16} />
            </IconButton>
            <IconButton
              onClick={() => setActiveTab('player')}
              label="切换到我的设定"
              tone={activeTab() === 'player' ? 'accent' : 'neutral'}
              active={activeTab() === 'player'}
            >
              <User size={16} />
            </IconButton>
          </div>
        </div>
      </div>

      <div class="relative flex-1 w-full min-h-0">
        <WorkspaceTransitionStage activeWorkspace={activeTab()} paneIds={['npc', 'player']}>
          {(tabId) => (
            <Switch fallback={<div />}>
              <Match when={tabId === 'npc'}>
                <div class="absolute inset-0 flex flex-col">
                  <div class="px-8 mb-6 flex-shrink-0">
                    <div class="relative group">
                      <Search class="absolute left-4 top-1/2 -translate-y-1/2 text-mist-solid/20 group-focus-within:text-accent transition-colors" size={18} />
                      <input
                        type="text"
                        value={search()}
                        onInput={(e) => setSearch(e.currentTarget.value)}
                        placeholder="搜索对话角色..."
                        class="w-full bg-transparent border-b border-white/20 rounded-none py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-accent transition-all placeholder:text-mist-solid/20"
                      />
                    </div>
                  </div>
                  <div class="flex-1 overflow-y-auto px-8 pb-24 custom-scrollbar">
                    <Show when={!props.loading} fallback={<div class="text-sm text-mist-solid/35">正在加载角色...</div>}>
                      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <For each={filteredCharacters().filter(c => c.cardType === "npc")}>
              {(character) => (
                <div class="group relative aspect-video overflow-hidden border-b-2 border-l-2 border-white/10 cursor-pointer hover:border-accent/40 transition-all">
                  
                  <img
                    src={resolveImageSrc(
                      character.imagePath,
                      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(character.name)}`,
                    )}
                    alt={character.name}
                    class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-700" style={{ "-webkit-mask-image": "linear-gradient(to top, black 20%, transparent 100%)", "mask-image": "linear-gradient(to top, black 20%, transparent 100%)" }}
                  />
                  
                  <div class="absolute bottom-0 left-0 right-0 p-4">
                    <h3 class="text-lg font-bold text-white mb-2 drop-shadow-lg">{character.name}</h3>
                    <div class="flex flex-wrap gap-2">
                      <For each={character.tags}>
                        {(tag) => (
                          <span class="text-[9px] px-2 py-0.5 rounded-none border border-current font-bold uppercase tracking-widest text-mist-solid/60 group-hover:text-accent transition-colors">
                            {tag}
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                  <div class="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0 duration-300">
                    <IconButton
                      onClick={(event) => {
                        event.stopPropagation();
                        openModal(character);
                      }}
                      label={`编辑角色 ${character.name}`}
                      size="sm"
                      class="bg-white/10 text-white"
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      onClick={(event) => {
                        event.stopPropagation();
                        void props.onDeleteCharacter(character.id);
                      }}
                      label={`删除角色 ${character.name}`}
                      tone="danger"
                      size="sm"
                      class="bg-white/10"
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>
              )}
            </For>
                      </div>
                    </Show>
                  </div>
                </div>
              </Match>
              <Match when={tabId === 'player'}>
                <div class="absolute inset-0 flex flex-col">
                  <div class="px-8 mb-6 flex-shrink-0">
                    <div class="relative group">
                      <Search class="absolute left-4 top-1/2 -translate-y-1/2 text-mist-solid/20 group-focus-within:text-accent transition-colors" size={18} />
                      <input
                        type="text"
                        value={search()}
                        onInput={(e) => setSearch(e.currentTarget.value)}
                        placeholder="搜索我的角色..."
                        class="w-full bg-transparent border-b border-white/20 rounded-none py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-accent transition-all placeholder:text-mist-solid/20"
                      />
                    </div>
                  </div>
                  <div class="flex-1 overflow-y-auto px-8 pb-24 custom-scrollbar">
                    <Show when={!props.loading} fallback={<div class="text-sm text-mist-solid/35">正在加载角色...</div>}>
                      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <For each={filteredCharacters().filter(c => c.cardType === "player")}>
              {(character) => (
                <div class="group relative aspect-video overflow-hidden border-b-2 border-l-2 border-white/10 cursor-pointer hover:border-accent/40 transition-all">
                  
                  <img
                    src={resolveImageSrc(
                      character.imagePath,
                      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(character.name)}`,
                    )}
                    alt={character.name}
                    class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-700" style={{ "-webkit-mask-image": "linear-gradient(to top, black 20%, transparent 100%)", "mask-image": "linear-gradient(to top, black 20%, transparent 100%)" }}
                  />
                  
                  <div class="absolute bottom-0 left-0 right-0 p-4">
                    <h3 class="text-lg font-bold text-white mb-2 drop-shadow-lg">{character.name}</h3>
                    <div class="flex flex-wrap gap-2">
                      <For each={character.tags}>
                        {(tag) => (
                          <span class="text-[9px] px-2 py-0.5 rounded-none border border-current font-bold uppercase tracking-widest text-mist-solid/60 group-hover:text-accent transition-colors">
                            {tag}
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                  <div class="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0 duration-300">
                    <IconButton
                      onClick={(event) => {
                        event.stopPropagation();
                        openModal(character);
                      }}
                      label={`编辑角色 ${character.name}`}
                      size="sm"
                      class="bg-white/10 text-white"
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      onClick={(event) => {
                        event.stopPropagation();
                        void props.onDeleteCharacter(character.id);
                      }}
                      label={`删除角色 ${character.name}`}
                      tone="danger"
                      size="sm"
                      class="bg-white/10"
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>
              )}
            </For>
                      </div>
                    </Show>
                  </div>
                </div>
              </Match>
              </Switch>
            )}
          </WorkspaceTransitionStage>
      </div>

      <div class={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm transition-all duration-300 ease-out ${isModalOpen() ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
          <div class={`w-full max-w-2xl bg-xuanqing border-y-2 border-white/10 p-8 shadow-2xl transition-all duration-300 ease-out delay-75 ${isModalOpen() ? "scale-100 translate-y-0 opacity-100" : "scale-[0.98] translate-y-4 opacity-0"}`}>
            <h2 class="text-xl font-bold text-white mb-6">{editingId() != null ? '编辑人设' : '创建新角色'}</h2>
            <div class="space-y-4 max-h-[70vh] overflow-y-auto px-2 -mx-2 custom-scrollbar">
              <div class="space-y-1">
                <label class="text-xs text-mist-solid/30 uppercase font-bold">角色名称</label>
                <input
                  type="text"
                  value={formData().name}
                  onInput={(e) => setFormData({ ...formData(), name: e.currentTarget.value })}
                  class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
                />
              </div>

              <div class="space-y-2">
                <label class="text-xs text-mist-solid/30 uppercase font-bold">角色图片</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  class="hidden"
                  onChange={(e) => void importImage(e.currentTarget.files?.[0])}
                />
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void importImage(e.dataTransfer?.files?.[0]);
                  }}
                  class="border-b border-dashed border-white/20 pb-4 flex flex-col gap-3"
                >
                  <img src={previewSrc()} alt="preview" class="w-full h-40 object-cover bg-black/20 border border-white/5" />
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs text-mist-solid/40 break-all">{formData().imagePath || '拖入图片到这里，或点击右侧按钮上传并保存到应用目录'}</div>
                    <IconButton
                      onClick={() => fileInputRef?.click()}
                      label={uploadingImage() ? '图片上传中' : '选择角色图片'}
                      tone={uploadingImage() ? 'success' : 'neutral'}
                      size="lg"
                    >
                      <Upload size={16} class={uploadingImage() ? 'animate-pulse' : ''} />
                    </IconButton>
                  </div>
                </div>
              </div>

              <div class="space-y-1">
                <label class="text-xs text-mist-solid/30 uppercase font-bold">兼容描述 / 回退文本</label>
                <textarea
                  value={formData().description}
                  onInput={(e) => setFormData({ ...formData(), description: e.currentTarget.value })}
                  class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid min-h-24 custom-scrollbar"
                />
                <p class="text-[11px] text-mist-solid/35 leading-5">
                  当结构化基础层段落为空时，后端会回退到这段描述文本。
                </p>
              </div>
              <div class="space-y-1">
                <label class="text-xs text-mist-solid/30 uppercase font-bold">标签 (逗号隔开)</label>
                <input
                  type="text"
                  value={formData().tags}
                  onInput={(e) => setFormData({ ...formData(), tags: e.currentTarget.value })}
                  class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
                />
              </div>

              <div class="space-y-3 pt-4 border-t border-white/5">
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <label class="text-xs text-mist-solid/30 uppercase font-bold">角色基础层段落</label>
                    <p class="text-[11px] text-mist-solid/35 mt-1">
                      用于定义第 2 层 CharacterBase，和首条消息、状态覆盖层分开保存。
                    </p>
                  </div>
                  <IconButton
                    onClick={() => setFormData({ ...formData(), baseSections: [...formData().baseSections, createEmptyBaseSection()] })}
                    label="新增角色基础层段落"
                    size="sm"
                  >
                    <Plus size={14} />
                  </IconButton>
                </div>
                <Show
                  when={formData().baseSections.length > 0}
                  fallback={<div class="text-xs text-mist-solid/35 border-l-2 border-dashed border-white/20 pl-4 py-2 mb-4">暂无结构化基础层段落，当前会仅显示兼容描述回退文本。</div>}
                >
                  <div class="space-y-3">
                    <For each={formData().baseSections}>
                      {(section, idx) => (
                        <div class="border-l-2 border-white/10 pl-4 py-2 space-y-4 mb-6">
                          <div class="flex items-center justify-between gap-3">
                            <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px] gap-3 flex-1">
                              <Select
  value={section.sectionKey}
  onChange={(val) => {
    const next = [...formData().baseSections];
    next[idx()] = { ...next[idx()], sectionKey: val };
    setFormData({ ...formData(), baseSections: next });
  }}
  options={[
  ...(BASE_SECTION_OPTIONS).map(option => ({ label: option.label, value: (option.value)?.toString() }))
  ]}
/>
                              <input
                                type="number"
                                value={section.sortOrder}
                                onInput={(e) => {
                                  const next = [...formData().baseSections];
                                  next[idx()] = { ...next[idx()], sortOrder: e.currentTarget.value };
                                  setFormData({ ...formData(), baseSections: next });
                                }}
                                placeholder="排序"
                                class="w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
                              />
                            </div>
                            <IconButton
                              onClick={() => {
                                const next = formData().baseSections.filter((_, index) => index !== idx());
                                setFormData({ ...formData(), baseSections: next });
                              }}
                              label="删除基础层段落"
                              tone="danger"
                              size="sm"
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </div>
                          <input
                            type="text"
                            value={section.title}
                            onInput={(e) => {
                              const next = [...formData().baseSections];
                              next[idx()] = { ...next[idx()], title: e.currentTarget.value };
                              setFormData({ ...formData(), baseSections: next });
                            }}
                            placeholder="段落标题（可选）"
                            class="w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
                          />
                          <textarea
                            value={section.content}
                            onInput={(e) => {
                              const next = [...formData().baseSections];
                              next[idx()] = { ...next[idx()], content: e.currentTarget.value };
                              setFormData({ ...formData(), baseSections: next });
                            }}
                            placeholder="输入该基础层段落正文，例如身份底座、人格底座、背景事实或长期规则。"
                            class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid min-h-24 custom-scrollbar"
                          />
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <Show when={activeTab() === 'npc'}>
                <div class="space-y-3 pt-4 border-t border-white/5">
                  <div class="flex items-center justify-between">
                    <label class="text-xs text-mist-solid/30 uppercase font-bold">首条消息 (多开局)</label>
                    <IconButton
                      onClick={() => setFormData({ ...formData(), firstMessages: [...formData().firstMessages, ''] })}
                      label="新增首条消息"
                      size="sm"
                    >
                      <Plus size={14} />
                    </IconButton>
                  </div>
                  <For each={formData().firstMessages}>
                    {(msg, idx) => (
                      <div class="flex gap-2">
                        <textarea
                          value={msg}
                          onInput={(e) => {
                            const next = [...formData().firstMessages];
                            next[idx()] = e.currentTarget.value;
                            setFormData({ ...formData(), firstMessages: next });
                          }}
                          class="flex-1 bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid min-h-20 custom-scrollbar"
                        />
                        <IconButton
                          onClick={() => {
                            const next = formData().firstMessages.filter((_, index) => index !== idx());
                            setFormData({ ...formData(), firstMessages: next });
                          }}
                          label="删除首条消息"
                          tone="danger"
                          size="sm"
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    )}
                  </For>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/5">
                  <div class="space-y-1">
                    <span class="text-[10px] text-mist-solid/40">关联世界书</span>
                    <Select
  value={formData().defaultWorldBookId}
  onChange={(val) => setFormData({ ...formData(), defaultWorldBookId: val })}
  options={[
  { label: "无关联", value: "" },
  ...(props.worldBooks).map(book => ({ label: book.title, value: (book.id)?.toString() }))
  ]}
/>
                  </div>
                  <div class="space-y-1">
                    <span class="text-[10px] text-mist-solid/40">模型 API</span>
                    <Select
  value={formData().defaultProviderId}
  onChange={(val) => setFormData({ ...formData(), defaultProviderId: val })}
  options={[
  { label: "跟随系统默认", value: "" },
  ...(props.providers).map(provider => ({ label: provider.name, value: (provider.id)?.toString() }))
  ]}
/>
                  </div>
                </div>
              </Show>
            </div>
            <div class="mt-8 flex items-center justify-between gap-4">
              <div>
                <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">表单操作</div>
                <div class="text-sm text-mist-solid/40 mt-1">取消编辑或保存当前角色。</div>
              </div>
              <div class="flex items-center gap-3">
                <IconButton onClick={() => setIsModalOpen(false)} label="取消角色编辑" size="lg">
                  <X size={18} />
                </IconButton>
                <IconButton onClick={() => void handleSave()} label="保存角色" tone="accent" size="lg">
                  <Save size={18} />
                </IconButton>
              </div>
            </div>
          </div>
        </div>
    </div>
  );
};
