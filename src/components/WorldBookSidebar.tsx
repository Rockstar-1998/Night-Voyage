import { Component, For, Show, createSignal } from 'solid-js';
import { BookOpen, Plus, Pencil, Save, Search, Trash2, Upload, X } from '../lib/icons';
import {
  importManagedImageFile,
  resolveImageSrc,
  type UpsertWorldBookEntryPayload,
  type WorldBookEntryRecord,
  type WorldBookSummary,
} from '../lib/backend';
import { WorldBookEntryArea } from './WorldBookEntryArea';
import { WorkspaceTransitionStage } from './WorkspaceTransitionStage';
import { Switch, Match } from 'solid-js';
import { IconButton } from './ui/IconButton';

interface WorldBookSidebarProps {
  worldBooks: WorldBookSummary[];
  activeEntries: WorldBookEntryRecord[];
  entriesLoading?: boolean;
  onLoadEntries: (worldBookId: number) => Promise<void> | void;
  onCreateWorldBook: (payload: { title: string; description?: string; imagePath?: string }) => Promise<void> | void;
  onUpdateWorldBook: (payload: { id: number; title?: string; description?: string; imagePath?: string }) => Promise<void> | void;
  onDeleteWorldBook: (id: number) => Promise<void> | void;
  onUpsertEntry: (payload: UpsertWorldBookEntryPayload) => Promise<void> | void;
  onDeleteEntry: (entryId: number) => Promise<void> | void;
}

interface WorldBookFormState {
  title: string;
  description: string;
  imagePath: string;
}

const EMPTY_FORM: WorldBookFormState = {
  title: '',
  description: '',
  imagePath: '',
};

export const WorldBookSidebar: Component<WorldBookSidebarProps> = (props) => {
  const [selectedBookId, setSelectedBookId] = createSignal<number | null>(null);
  const [search, setSearch] = createSignal('');
  const [isModalOpen, setIsModalOpen] = createSignal(false);
  const [editingBookId, setEditingBookId] = createSignal<number | null>(null);
  const [formData, setFormData] = createSignal<WorldBookFormState>(EMPTY_FORM);
  const [uploadingImage, setUploadingImage] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;

  const activeBook = () => props.worldBooks.find((book) => book.id === selectedBookId());
  const filteredBooks = () => {
    const query = search().trim().toLowerCase();
    if (!query) return props.worldBooks;
    return props.worldBooks.filter((book) => `${book.title} ${book.description ?? ''}`.toLowerCase().includes(query));
  };

  const openModal = (book?: WorldBookSummary) => {
    if (book) {
      setEditingBookId(book.id);
      setFormData({
        title: book.title,
        description: book.description ?? '',
        imagePath: book.imagePath ?? '',
      });
    } else {
      setEditingBookId(null);
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

  const handleSave = async () => {
    const data = formData();
    const payload = {
      title: data.title.trim() || '新世界书',
      description: data.description.trim() || undefined,
      imagePath: data.imagePath.trim() || undefined,
    };

    if (editingBookId() != null) {
      await props.onUpdateWorldBook({ id: editingBookId()!, ...payload });
    } else {
      await props.onCreateWorldBook(payload);
    }

    setIsModalOpen(false);
  };

  return (
    <>
      <div class="relative h-full w-full">
        <WorkspaceTransitionStage
          activeWorkspace={(!selectedBookId() || !activeBook()) ? 'list' : 'entry'}
          paneIds={['list', 'entry']}
        >
          {(viewId) => (
            <Switch fallback={<div />}>
              <Match when={viewId === 'entry'}>
                <div class="h-full w-full flex flex-col relative bg-transparent">
                  <Show when={activeBook()}>
                    {(safeBook) => (
                      <WorldBookEntryArea
                        book={safeBook()}
                        entries={props.activeEntries}
                        loading={props.entriesLoading}
                        onBack={() => setSelectedBookId(null)}
                        onUpsertEntry={props.onUpsertEntry}
                        onDeleteEntry={props.onDeleteEntry}
                      />
                    )}
                  </Show>
                </div>
              </Match>
              <Match when={viewId === 'list'}>
                <div class="w-full flex flex-col bg-transparent h-full relative pt-10">
          <div class="p-8 flex flex-col gap-6">
            <div class="flex items-center justify-between">
              <h1 class="text-3xl font-black text-white tracking-tighter uppercase italic">世界书</h1>
              <IconButton onClick={() => openModal()} label="新建世界书" tone="accent" size="lg">
                <Plus size={18} />
              </IconButton>
            </div>

            <div class="relative group">
              <Search class="absolute left-4 top-1/2 -translate-y-1/2 text-mist-solid/20 group-focus-within:text-accent transition-colors" size={18} />
              <input
                type="text"
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                placeholder="搜索世界书..."
                class="w-full bg-transparent border-b-2 border-white/10 py-3 pl-12 pr-4 rounded-none text-sm focus:outline-none focus:border-accent/40 transition-all placeholder:text-mist-solid/20"
              />
            </div>
          </div>

          <div class="flex-1 overflow-y-auto px-8 pb-24 custom-scrollbar">
            <div class="grid grid-cols-2 xl:grid-cols-3 gap-6">
              <For each={filteredBooks()}>
                {(book) => (
                  <div class="group relative aspect-video overflow-hidden bg-transparent border-b-2 border-l-2 border-white/10 rounded-none cursor-pointer hover:border-accent/40 transition-all shadow-2xl hover:shadow-accent/10">
                    <button
                      onClick={() => {
                        setSelectedBookId(book.id);
                        void props.onLoadEntries(book.id);
                      }}
                      class="absolute inset-0 w-full h-full text-left"
                    >
                      <div class="absolute inset-0 bg-accent/5" />
                      <Show when={resolveImageSrc(book.imagePath, '')}>
                        <img
                          src={resolveImageSrc(book.imagePath, '')}
                          alt={book.title}
                          class="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-all duration-700"
                        />
                      </Show>
                      <div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />
                      <div class="absolute bottom-0 left-0 right-0 p-4">
                        <h3 class="text-lg font-bold text-white mb-1 drop-shadow-lg">{book.title}</h3>
                        <p class="text-[11px] text-mist-solid/45 line-clamp-2 min-h-[32px]">{book.description || '暂无描述'}</p>
                        <div class="mt-2 flex items-center justify-between">
                          <div class="flex items-center gap-1.5 text-mist-solid/30 text-[10px] font-bold uppercase tracking-widest">
                            <BookOpen size={12} />
                            {book.entryCount} 条目
                          </div>
                        </div>
                      </div>
                    </button>

                    <div class="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <IconButton
                        onClick={(event) => {
                          event.stopPropagation();
                          openModal(book);
                        }}
                        label={`编辑世界书 ${book.title}`}
                        size="sm"
                        class="bg-white/10 text-white"
                      >
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        onClick={(event) => {
                          event.stopPropagation();
                          void props.onDeleteWorldBook(book.id);
                        }}
                        label={`删除世界书 ${book.title}`}
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
          </div>
        </div>
      </Match>
          </Switch>
        )}
        </WorkspaceTransitionStage>
      </div>

      <div class={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm transition-all duration-300 ease-out ${isModalOpen() ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
          <div class={`w-full max-w-2xl bg-xuanqing border-y-2 border-white/10 p-8 shadow-2xl transition-all duration-300 ease-out delay-75 ${isModalOpen() ? "scale-100 translate-y-0 opacity-100" : "scale-[0.98] translate-y-4 opacity-0"}`}>
            <h2 class="text-xl font-bold text-white mb-6">{editingBookId() != null ? '编辑世界书' : '创建世界书'}</h2>
            <div class="space-y-4 max-h-[70vh] overflow-y-auto px-2 -mx-2 custom-scrollbar">
              <div class="space-y-1">
                <label class="text-xs text-mist-solid/30 uppercase font-bold">世界书标题</label>
                <input
                  type="text"
                  value={formData().title}
                  onInput={(e) => setFormData({ ...formData(), title: e.currentTarget.value })}
                  class="w-full bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
                />
              </div>

              <div class="space-y-2">
                <label class="text-xs text-mist-solid/30 uppercase font-bold">世界书图片</label>
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
                  <Show when={resolveImageSrc(formData().imagePath, '')}>
                    <img
                      src={resolveImageSrc(formData().imagePath, '')}
                      alt="worldbook preview"
                      class="w-full h-40 object-cover bg-black/20"
                    />
                  </Show>
                  <Show when={!resolveImageSrc(formData().imagePath, '')}>
                    <div class="w-full h-40 bg-black/20 flex items-center justify-center">
                      <span class="text-xs text-mist-solid/25">拖入图片到这里，或点击右侧按钮上传</span>
                    </div>
                  </Show>
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-xs text-mist-solid/40 break-all">{formData().imagePath || '拖入图片到这里，或点击右侧按钮上传并保存到应用目录'}</div>
                    <IconButton
                      onClick={() => fileInputRef?.click()}
                      label={uploadingImage() ? '世界书图片上传中' : '选择世界书图片'}
                      tone={uploadingImage() ? 'success' : 'neutral'}
                      size="lg"
                    >
                      <Upload size={16} class={uploadingImage() ? 'animate-pulse' : ''} />
                    </IconButton>
                  </div>
                </div>
              </div>

              <div class="space-y-1">
                <label class="text-xs text-mist-solid/30 uppercase font-bold">世界书描述</label>
                <textarea
                  value={formData().description}
                  onInput={(e) => setFormData({ ...formData(), description: e.currentTarget.value })}
                  class="w-full bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid min-h-24 custom-scrollbar"
                />
              </div>
            </div>
            <div class="mt-8 flex items-center justify-between gap-4">
              <div>
                <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">表单操作</div>
                <div class="text-sm text-mist-solid/40 mt-1">取消编辑或保存当前世界书。</div>
              </div>
              <div class="flex items-center gap-3">
                <IconButton onClick={() => setIsModalOpen(false)} label="取消世界书编辑" size="lg">
                  <X size={18} />
                </IconButton>
                <IconButton onClick={() => void handleSave()} label="保存世界书" tone="accent" size="lg">
                  <Save size={18} />
                </IconButton>
              </div>
            </div>
          </div>
      </div>
    </>
  );
};
