import { createStore } from "solid-js/store";
import { createEffect } from "solid-js";

export interface WorldBookEntry {
    id: string;
    title: string;
    keywords: string[];
    content: string;
    enabled: boolean;
}

export interface WorldBook {
    id: string;
    title: string;
    description: string;
    image: string;
    tags: string[];
    entries: WorldBookEntry[];
}

const STORAGE_KEY = "night_voyage_world_books";

const defaultBooks: WorldBook[] = [
    {
        id: 'wb1',
        title: '夜航船秘典',
        description: '记录着这艘穿梭于虚无之海船只的所有航行日志。',
        image: 'https://api.dicebear.com/7.x/identicon/svg?seed=Voyage',
        tags: ['核心设定'],
        entries: [
            { id: 'e1', title: '核心动力源', keywords: ['动力', '核心', '能源'], content: '这艘船由一种古老的虚无能量驱动，不需要常规燃料。', enabled: true },
            { id: 'e2', title: '观测室规则', keywords: ['观测', '规则'], content: '在深夜不可凝视船窗外超过十分钟，以免意志被深空感染。', enabled: true }
        ]
    },
    {
        id: 'wb2',
        title: '虚空生物志',
        description: '对深海中游荡的各类发光生物、捕食者的详细记录。',
        image: 'https://api.dicebear.com/7.x/identicon/svg?seed=Void',
        tags: ['生物'],
        entries: [
            { id: 'e3', title: '幽蓝水母', keywords: ['水母', '发光'], content: '无害的生物，靠近会提供微弱的护盾，触手带有非常轻微的麻痹毒素。', enabled: true }
        ]
    },
    {
        id: 'wb3',
        title: '以太契约',
        description: '关于能量流转、魔法阵构造以及灵魂契约的法则汇编。',
        image: 'https://api.dicebear.com/7.x/identicon/svg?seed=Ether',
        tags: ['法理'],
        entries: []
    },
    {
        id: 'wb4',
        title: '断层文明',
        description: '那些早已沉没在量子之海底部的古代文明残骸研究。',
        image: 'https://api.dicebear.com/7.x/identicon/svg?seed=Civilization',
        tags: ['考古'],
        entries: []
    }
];

const [worldBooks, setWorldBooks] = createStore<WorldBook[]>([]);

// Initialize from localStorage
const stored = localStorage.getItem(STORAGE_KEY);
if (stored) {
    try {
        setWorldBooks(JSON.parse(stored));
    } catch (e) {
        console.error("Failed to parse stored world books", e);
    }
} else {
    setWorldBooks(defaultBooks);
}

// Persist changes
createEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(worldBooks));
});

export const worldBookStore = {
    books: worldBooks,
    addEntry: (bookId: string, entry: Omit<WorldBookEntry, 'id'>) => {
        setWorldBooks(
            b => b.id === bookId,
            'entries',
            e => [...e, { ...entry, id: `entry-${Date.now()}` }]
        );
    },
    updateEntry: (bookId: string, entryId: string, updates: Partial<WorldBookEntry>) => {
        setWorldBooks(
            b => b.id === bookId,
            'entries',
            e => e.id === entryId,
            updates
        );
    },
    removeEntry: (bookId: string, entryId: string) => {
        setWorldBooks(
            b => b.id === bookId,
            'entries',
            e => e.filter(entry => entry.id !== entryId)
        );
    }
};
