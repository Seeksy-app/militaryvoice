import * as L from "lucide-react";

/**
 * The 3D icon set (Andrew, 21 Nov 2026: "update the 3-d icon everywhere", Clay-style). Microsoft Fluent 3D emoji,
 * MIT licence (client/public/icons3d/LICENSE-fluentui-emoji.txt), one 192px WebP per concept in /icons3d/.
 *
 * Where they go: feature tiles (IconTile), dashboard doors, section headers, empty states, the homepage.
 * Where they don't: nav, small controls under 20px (check, x, arrows, chevrons), brand logos (stay official and flat).
 */
export const ICONS_3D = [
  "mic", "headphone", "video", "camera", "tv", "wave", "radio", "antenna", "megaphone", "coin", "moneybag",
  "check", "shield", "link", "gear", "building", "sparkles", "wand", "inbox", "outbox", "search", "chat", "handshake",
  "clapper", "film", "calendar", "mail", "send", "scissors", "card", "globe", "chart", "trend", "rocket", "bulb", "books",
  "lock", "key", "music", "robot", "compass", "folder", "page", "target", "heart", "picture", "stopwatch", "bolt", "house",
  "question", "bookmark", "disc", "trash", "warning", "eyes", "crown", "gift", "trophy", "bell", "package", "phone",
  "laptop", "clipboard", "star", "party", "palette", "notebook", "memo", "newspaper", "ticket", "pin", "briefcase",
  "cardindex", "hourglass", "label",
] as const;
export type Icon3D = (typeof ICONS_3D)[number];

export const icon3dSrc = (k: Icon3D) => `/icons3d/${k}.webp`;

type AnyIcon = unknown;
/** The line icon a tile was given → its 3D concept. Icons not here stay line (controls, arrows, brand marks). */
const FROM_LINE = new Map<AnyIcon, Icon3D>([
  [L.Mic, "mic"], [L.Mic2, "mic"], [L.Podcast, "headphone"], [L.Headphones, "headphone"],
  [L.Video, "video"], [L.Camera, "camera"], [L.MonitorPlay, "tv"], [L.Tv, "tv"],
  [L.Users, "handshake"], [L.UserPlus, "wave"], [L.UserRound, "wave"], [L.User, "wave"], [L.Contact, "cardindex"], [L.UserSearch, "search"],
  [L.Radio, "radio"], [L.Wifi, "antenna"], [L.Signal, "antenna"], [L.SignalHigh, "antenna"],
  [L.Megaphone, "megaphone"], [L.Coins, "coin"], [L.DollarSign, "moneybag"], [L.Wallet, "moneybag"],
  [L.BadgeCheck, "check"], [L.CheckCircle2, "check"], [L.ShieldCheck, "shield"], [L.Shield, "shield"],
  [L.Cable, "link"], [L.Webhook, "link"], [L.Link2, "link"], [L.Link, "link"], [L.Workflow, "gear"], [L.Settings, "gear"], [L.Settings2, "gear"],
  [L.Building2, "building"], [L.Building, "building"], [L.Sparkles, "sparkles"], [L.Wand2, "wand"],
  [L.Upload, "outbox"], [L.Download, "inbox"], [L.Inbox, "inbox"], [L.Search, "search"],
  [L.MessagesSquare, "chat"], [L.MessageSquare, "chat"], [L.MessageCircle, "chat"], [L.Handshake, "handshake"],
  [L.Clapperboard, "clapper"], [L.Film, "film"], [L.CalendarDays, "calendar"], [L.Calendar, "calendar"], [L.CalendarClock, "calendar"],
  [L.Mail, "mail"], [L.Send, "send"], [L.Scissors, "scissors"], [L.CreditCard, "card"], [L.Globe, "globe"],
  [L.BarChart3, "chart"], [L.TrendingUp, "trend"], [L.Activity, "trend"], [L.Rocket, "rocket"], [L.Lightbulb, "bulb"], [L.Library, "books"],
  [L.Lock, "lock"], [L.KeyRound, "key"], [L.Music2, "music"], [L.Music, "music"], [L.Bot, "robot"], [L.Compass, "compass"],
  [L.FolderOpen, "folder"], [L.Folder, "folder"], [L.FileText, "page"], [L.FileAudio, "page"], [L.Target, "target"], [L.Heart, "heart"],
  [L.Image, "picture"], [L.ImagePlus, "picture"], [L.Clock, "stopwatch"], [L.Clock3, "stopwatch"], [L.Timer, "stopwatch"], [L.Zap, "bolt"],
  [L.Home, "house"], [L.HelpCircle, "question"], [L.Bookmark, "bookmark"], [L.Disc, "disc"], [L.Trash2, "trash"], [L.AlertTriangle, "warning"],
  [L.Eye, "eyes"], [L.Crown, "crown"], [L.Gift, "gift"], [L.Trophy, "trophy"], [L.Bell, "bell"], [L.Package, "package"],
  [L.Smartphone, "phone"], [L.Laptop, "laptop"], [L.ClipboardList, "clipboard"], [L.Clipboard, "clipboard"], [L.ClipboardCheck, "clipboard"],
  [L.Star, "star"], [L.PartyPopper, "party"], [L.Palette, "palette"], [L.Notebook, "notebook"], [L.NotebookPen, "memo"], [L.FileEdit, "memo"],
  [L.Check, "check"], [L.Youtube, "tv"], [L.Crop, "scissors"], [L.Share2, "megaphone"], [L.Type, "memo"], [L.Captions, "memo"], [L.Presentation, "tv"], [L.Move, "package"],
  [L.LayoutGrid, "picture"], [L.Keyboard, "laptop"], [L.IdCard, "cardindex"], [L.Globe2, "globe"], [L.MessageSquareQuote, "chat"],
  [L.MessageSquareText, "chat"], [L.ListPlus, "clipboard"], [L.AtSign, "mail"],
  [L.Newspaper, "newspaper"], [L.Ticket, "ticket"], [L.MapPin, "pin"], [L.Briefcase, "briefcase"], [L.Hourglass, "hourglass"], [L.Tag, "label"],
]);

export const icon3dFor = (icon: AnyIcon): Icon3D | undefined => FROM_LINE.get(icon);
