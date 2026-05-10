import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { Pencil, Plus, Save, Search, Trash2, Upload, User, Users, X } from '../lib/icons';
import { IconButton } from './ui/IconButton';
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
    <div class="w-full flex flex-col bg-night-water border-r border-white/5 h-full relative pt-10">
      <div class="p-8 flex flex-col gap-6">
        <div class="flex items-center justify-between">
          <h1 class="text-3xl font-black text-white tracking-tighter uppercase italic">角色展示柜</h1>
          <IconButton onClick={() => openModal()} label="添加角色" tone="accent" size="lg">
            <Plus size={18} />
          </IconButton>
        </div>

        <div class="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-xuanqing p-3">
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

        <div class="relative group">
          <Search class="absolute left-4 top-1/2 -translate-y-1/2 text-mist-solid/20 group-focus-within:text-accent transition-colors" size={18} />
          <input
            type="text"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            placeholder={activeTab() === 'player' ? '搜索我的角色...' : '搜索角色卡...'}
            class="w-full bg-xuanqing border border-white/5 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-accent/40 transition-all placeholder:text-mist-solid/20"
          />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-8 pb-24 custom-scrollbar">
        <Show when={!props.loading} fallback={<div class="text-sm text-mist-solid/35">正在加载角色...</div>}>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <For each={filteredCharacters()}>
              {(character) => (
                <div class="group relative aspect-video rounded-2xl overflow-hidden bg-xuanqing border border-white/10 cursor-pointer hover:border-accent/40 transition-all shadow-2xl hover:shadow-accent/10">
                  <div class="absolute inset-0 bg-accent/5" />
                  <img
                    src={resolveImageSrc(
                      character.imagePath,
                      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(character.name)}`,
                    )}
                    alt={character.name}
                    class="w-full h-full object-cover opacity-50 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700"
                  />
                  <div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />
                  <div class="absolute bottom-0 left-0 right-0 p-4">
                    <h3 class="text-lg font-bold text-white mb-2 drop-shadow-lg">{character.name}</h3>
                    <div class="flex flex-wrap gap-2">
                      <For each={character.tags}>
                        {(tag) => (
                          <span class="text-[10px] px-2 py-0.5 rounded-md bg-accent/20 text-accent/90 border border-accent/10 backdrop-blur-sm">
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

      <Show when={isModalOpen()}>
        <div class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div class="w-full max-w-2xl bg-xuanqing border border-white/10 rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-300">
            <h2 class="text-xl font-bold text-white mb-6">{editingId() != null ? '编辑人设' : '创建新角色'}</h2>
            <div class="space-y-4 max-h-[70vh] overflow-y-auto px-2 -mx-2 custom-scrollbar">
              <div class="space-y-1">
                <label class="text-xs text-mist-solid/30 uppercase font-bold">角色名称</label>
                <input
                  type="text"
                  value={formData().name}
                  onInput={(e) => setFormData({ ...formData(), name: e.currentTarget.value })}
                  class="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
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
                  class="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 flex flex-col gap-3"
                >
                  <img src={previewSrc()} alt="preview" class="w-full h-40 object-cover rounded-xl bg-black/20" />
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
                  class="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid min-h-24 custom-scrollbar"
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
                  class="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
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
                  fallback={<div class="text-xs text-mist-solid/35 rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3">暂无结构化基础层段落，当前会仅显示兼容描述回退文本。</div>}
                >
                  <div class="space-y-3">
                    <For each={formData().baseSections}>
                      {(section, idx) => (
                        <div class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                          <div class="flex items-center justify-between gap-3">
                            <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px] gap-3 flex-1">
                              <select
                                value={section.sectionKey}
                                onChange={(e) => {
                                  const next = [...formData().baseSections];
                                  next[idx()] = {
                                    ...next[idx()],
                                    sectionKey: e.currentTarget.value as CharacterBaseSectionKey,
                                  };
                                  setFormData({ ...formData(), baseSections: next });
                                }}
                                class="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid appearance-none"
                              >
                                <For each={BASE_SECTION_OPTIONS}>
                                  {(option) => <option value={option.value}>{option.label}</option>}
                                </For>
                              </select>
                              <input
                                type="number"
                                value={section.sortOrder}
                                onInput={(e) => {
                                  const next = [...formData().baseSections];
                                  next[idx()] = { ...next[idx()], sortOrder: e.currentTarget.value };
                                  setFormData({ ...formData(), baseSections: next });
                                }}
                                placeholder="排序"
                                class="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
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
                            class="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
                          />
                          <textarea
                            value={section.content}
                            onInput={(e) => {
                              const next = [...formData().baseSections];
                              next[idx()] = { ...next[idx()], content: e.currentTarget.value };
                              setFormData({ ...formData(), baseSections: next });
                            }}
                            placeholder="输入该基础层段落正文，例如身份底座、人格底座、背景事实或长期规则。"
                            class="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid min-h-24 custom-scrollbar"
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
                          class="flex-1 bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid min-h-20 custom-scrollbar"
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
                    <select
                      value={formData().defaultWorldBookId}
                      onChange={(e) => setFormData({ ...formData(), defaultWorldBookId: e.currentTarget.value })}
                      class="w-full bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-accent/40 text-mist-solid appearance-none"
                    >
                      <option value="">无关联</option>
                      <For each={props.worldBooks}>{(book) => <option value={book.id}>{book.title}</option>}</For>
                    </select>
                  </div>
                  <div class="space-y-1">
                    <span class="text-[10px] text-mist-solid/40">模型 API</span>
                    <select
                      value={formData().defaultProviderId}
                      onChange={(e) => setFormData({ ...formData(), defaultProviderId: e.currentTarget.value })}
                      class="w-full bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-accent/40 text-mist-solid appearance-none"
                    >
                      <option value="">跟随系统默认</option>
                      <For each={props.providers}>{(provider) => <option value={provider.id}>{provider.name}</option>}</For>
                    </select>
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
      </Show>
    </div>
  );
};
