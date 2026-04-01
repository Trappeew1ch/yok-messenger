export interface User {
  id: string;
  name: string;
  avatar: string;
  online: boolean;
  lastSeen?: string;
  profileColor?: string;
  profileEmoji?: string;
  backgroundEmoji?: string[];
}

export interface Message {
  id: string;
  senderId: string;
  text?: string;
  type: 'text' | 'voice' | 'image' | 'video';
  timestamp: string;
  read: boolean;
  mediaUrl?: string;
  duration?: number;
}

export interface Chat {
  id: string;
  user: User;
  messages: Message[];
  unread: number;
  pinned: boolean;
  muted: boolean;
  lastMessage: string;
  lastTime: string;
}

export const currentUser: User = {
  id: 'me',
  name: 'Богдан',
  avatar: '',
  online: true,
  profileColor: '#8B5CF6',
  profileEmoji: '🚀',
  backgroundEmoji: ['💻', '🎯', '⚡'],
};

export const users: User[] = [
  { id: '1', name: 'Алексей Петров', avatar: '👨‍💻', online: true, profileColor: '#3B82F6', profileEmoji: '💻', backgroundEmoji: ['📱', '🖥️', '⌨️'] },
  { id: '2', name: 'Мария Иванова', avatar: '👩‍🎨', online: false, lastSeen: 'была 2 часа назад', profileColor: '#EC4899', profileEmoji: '🎨', backgroundEmoji: ['🖌️', '🎭', '✨'] },
  { id: '3', name: 'Дмитрий Козлов', avatar: '🧑‍🚀', online: true, profileColor: '#F59E0B', profileEmoji: '🚀', backgroundEmoji: ['🌟', '🪐', '🛸'] },
  { id: '4', name: 'Анна Смирнова', avatar: '👩‍⚕️', online: false, lastSeen: 'была вчера', profileColor: '#10B981', profileEmoji: '🌿', backgroundEmoji: ['🍀', '🌸', '💚'] },
  { id: '5', name: 'Команда YOK', avatar: '🚀', online: true, profileColor: '#8B5CF6', profileEmoji: '⚡', backgroundEmoji: ['🔥', '💬', '🎉'] },
  { id: '6', name: 'Екатерина Волкова', avatar: '👩‍🔬', online: false, lastSeen: 'была 30 мин назад', profileColor: '#6366F1', profileEmoji: '🔬', backgroundEmoji: ['🧪', '⚗️', '🔭'] },
  { id: '7', name: 'Максим Новиков', avatar: '🎮', online: true, profileColor: '#EF4444', profileEmoji: '🎮', backgroundEmoji: ['🕹️', '🏆', '🎯'] },
  { id: '8', name: 'Ольга Федорова', avatar: '📸', online: false, lastSeen: 'была 5 мин назад', profileColor: '#F97316', profileEmoji: '📸', backgroundEmoji: ['🌅', '🏞️', '🎞️'] },
];

export const chats: Chat[] = [
  {
    id: 'c1',
    user: users[0],
    unread: 3,
    pinned: true,
    muted: false,
    lastMessage: 'Привет! Как продвигается проект?',
    lastTime: '22:15',
    messages: [
      { id: 'm1', senderId: '1', text: 'Привет! 👋', type: 'text', timestamp: '22:00', read: true },
      { id: 'm2', senderId: 'me', text: 'Привет, Алексей! Всё отлично, работаю над дизайном', type: 'text', timestamp: '22:02', read: true },
      { id: 'm3', senderId: '1', text: 'Классно! Покажешь когда будет готово?', type: 'text', timestamp: '22:05', read: true },
      { id: 'm4', senderId: 'me', type: 'image', timestamp: '22:08', read: true, mediaUrl: '/placeholder-image.jpg', text: '' },
      { id: 'm5', senderId: '1', text: 'Вау, выглядит потрясающе! 🔥', type: 'text', timestamp: '22:10', read: true },
      { id: 'm6', senderId: 'me', type: 'voice', timestamp: '22:12', read: true, duration: 15, text: '' },
      { id: 'm7', senderId: '1', text: 'Привет! Как продвигается проект?', type: 'text', timestamp: '22:15', read: false },
    ],
  },
  {
    id: 'c2',
    user: users[1],
    unread: 0,
    pinned: true,
    muted: false,
    lastMessage: 'Отправила новые макеты 🎨',
    lastTime: '21:30',
    messages: [
      { id: 'm8', senderId: '2', text: 'Привет! Закончила макеты для лендинга', type: 'text', timestamp: '21:00', read: true },
      { id: 'm9', senderId: '2', type: 'image', timestamp: '21:05', read: true, mediaUrl: '/placeholder-design.jpg', text: '' },
      { id: 'm10', senderId: 'me', text: 'Отличная работа, Мария! Мне нравится цветовая палитра', type: 'text', timestamp: '21:15', read: true },
      { id: 'm11', senderId: '2', text: 'Отправила новые макеты 🎨', type: 'text', timestamp: '21:30', read: true },
    ],
  },
  {
    id: 'c3',
    user: users[2],
    unread: 1,
    pinned: false,
    muted: false,
    lastMessage: 'Завтра созвон в 10:00',
    lastTime: '20:45',
    messages: [
      { id: 'm12', senderId: '3', text: 'Йо! Завтра созвон в 10:00, не забудь', type: 'text', timestamp: '20:40', read: true },
      { id: 'm13', senderId: '3', text: 'Завтра созвон в 10:00', type: 'text', timestamp: '20:45', read: false },
    ],
  },
  {
    id: 'c4',
    user: users[3],
    unread: 0,
    pinned: false,
    muted: true,
    lastMessage: 'Хорошо, договорились',
    lastTime: '19:20',
    messages: [
      { id: 'm14', senderId: 'me', text: 'Анна, можешь глянуть документацию?', type: 'text', timestamp: '19:00', read: true },
      { id: 'm15', senderId: '4', text: 'Хорошо, договорились', type: 'text', timestamp: '19:20', read: true },
    ],
  },
  {
    id: 'c5',
    user: users[4],
    unread: 12,
    pinned: false,
    muted: false,
    lastMessage: '🎉 Релиз v2.0 готов!',
    lastTime: '18:00',
    messages: [
      { id: 'm16', senderId: '5', text: '🎉 Релиз v2.0 готов!', type: 'text', timestamp: '18:00', read: false },
      { id: 'm17', senderId: '5', type: 'video', timestamp: '17:55', read: false, mediaUrl: '/placeholder-video.mp4', duration: 45, text: '' },
    ],
  },
  {
    id: 'c6',
    user: users[5],
    unread: 0,
    pinned: false,
    muted: false,
    lastMessage: 'Спасибо за помощь!',
    lastTime: 'Вчера',
    messages: [],
  },
  {
    id: 'c7',
    user: users[6],
    unread: 2,
    pinned: false,
    muted: false,
    lastMessage: 'Го в кс? 😄',
    lastTime: 'Вчера',
    messages: [],
  },
  {
    id: 'c8',
    user: users[7],
    unread: 0,
    pinned: false,
    muted: false,
    lastMessage: 'Фотки с поездки 📸',
    lastTime: 'Пн',
    messages: [],
  },
];

export const settingsSections = [
  {
    title: 'Аккаунт',
    items: [
      { icon: 'user', label: 'Профиль', value: '' },
      { icon: 'phone', label: 'Номер телефона', value: '+7 (999) ***-**-42' },
      { icon: 'at', label: 'Имя пользователя', value: '@bogdan' },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { icon: 'bell', label: 'Уведомления', value: '' },
      { icon: 'lock', label: 'Конфиденциальность', value: '' },
      { icon: 'palette', label: 'Оформление', value: '' },
      { icon: 'globe', label: 'Язык', value: 'Русский' },
      { icon: 'database', label: 'Данные и хранилище', value: '' },
    ],
  },
  {
    title: 'Помощь',
    items: [
      { icon: 'help', label: 'FAQ', value: '' },
      { icon: 'info', label: 'О приложении', value: 'YOK v1.0' },
    ],
  },
];

export const profileMedia = [
  { type: 'image', label: '24 фото', icon: '🖼️' },
  { type: 'video', label: '8 видео', icon: '🎬' },
  { type: 'file', label: '15 файлов', icon: '📄' },
  { type: 'link', label: '32 ссылки', icon: '🔗' },
  { type: 'voice', label: '12 голосовых', icon: '🎙️' },
];
