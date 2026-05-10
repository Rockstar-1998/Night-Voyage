import { createStore } from "solid-js/store";
import { createEffect } from "solid-js";

export interface Character {
    id: string;
    name: string;
    description: string;
    image: string;
    tags: string[];
    // New fields for NPC Editing
    firstMessages?: string[];
    defaultWorldBookId?: string;
    defaultPresetId?: string;
    defaultApiId?: string;
}

const STORAGE_KEY = "night_voyage_player_characters";
const NPC_STORAGE_KEY = "night_voyage_npc_characters";

const [playerCharacters, setPlayerCharacters] = createStore<Character[]>([]);
const [npcCharacters, setNpcCharacters] = createStore<Character[]>([]);


// Initialize from localStorage
const stored = localStorage.getItem(STORAGE_KEY);
if (stored) {
    try {
        setPlayerCharacters(JSON.parse(stored));
    } catch (e) {
        console.error("Failed to parse stored characters", e);
    }
} else {
    // Default dummy player characters
    setPlayerCharacters([
        {
            id: 'p1',
            name: '观测者 (You)',
            description: '穿梭于无数梦境与现实之间的主控意志。',
            image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Observer',
            tags: ['核心意志', '时空跳跃']
        },
        {
            id: 'p2',
            name: '副人格 - 极光',
            description: '处理感性反馈与直觉判断的次生意识流。',
            image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Aurora',
            tags: ['直觉补完', '情感过滤']
        }
    ]);
}

// Persist changes
createEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playerCharacters));
});

// Initialize NPCs from localStorage
const storedNpcs = localStorage.getItem(NPC_STORAGE_KEY);
if (storedNpcs) {
    try {
        setNpcCharacters(JSON.parse(storedNpcs));
    } catch (e) {
        console.error("Failed to parse stored npc characters", e);
    }
} else {
    // Default dummy NPC characters
    setNpcCharacters([
        {
            id: '1',
            name: '莉莉丝',
            description: '神秘的夜航船向导，拥有引导灵魂的能力。',
            image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lilith',
            tags: ['灵魂导引', '永恒守望'],
            firstMessages: ['欢迎来到夜航船。我是你的向导，莉莉丝。准备好启程了吗？']
        },
        {
            id: '2',
            name: '艾利克斯',
            description: '资深的系统架构师，冷峻而高效。',
            image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex',
            tags: ['逻辑中枢', '架构专家']
        },
        {
            id: '3',
            name: '幽灵小助手',
            description: '偶尔出没的幽灵，擅长处理琐碎的任务。',
            image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ghost',
            tags: ['虚无协助', '任务达人']
        },
        {
            id: '4',
            name: '莫娜',
            description: '占星术士，观测着群星的命运。',
            image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Mona',
            tags: ['星象观测', '命运编织']
        },
        {
            id: '5',
            name: 'K-9',
            description: '忠诚的机械犬，扫描一切潜在威胁。',
            image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=K9',
            tags: ['守卫链路', '侦测核心']
        },
        {
            id: '6',
            name: '塞壬',
            description: '歌声悦耳但也危险，生活在深海之渊。',
            image: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Siren',
            tags: ['深海之音', '惑乱歌者']
        }
    ]);
}

createEffect(() => {
    localStorage.setItem(NPC_STORAGE_KEY, JSON.stringify(npcCharacters));
});

export const characterStore = {
    characters: playerCharacters,
    npcCharacters: npcCharacters,
    add: (char: Omit<Character, 'id'>) => {
        const newChar = { ...char, id: Date.now().toString() };
        setPlayerCharacters([...playerCharacters, newChar]);
    },
    update: (id: string, updates: Partial<Character>) => {
        setPlayerCharacters(c => c.id === id, updates);
    },
    remove: (id: string) => {
        setPlayerCharacters(playerCharacters.filter(c => c.id !== id));
    },
    addNpc: (char: Omit<Character, 'id'>) => {
        const newChar = { ...char, id: Date.now().toString() };
        setNpcCharacters([...npcCharacters, newChar]);
    },
    updateNpc: (id: string, updates: Partial<Character>) => {
        setNpcCharacters(c => c.id === id, updates);
    },
    removeNpc: (id: string) => {
        setNpcCharacters(npcCharacters.filter(c => c.id !== id));
    }
};
