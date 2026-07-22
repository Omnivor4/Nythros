export const theme = {
  colors: {
    // === BACKGROUND ===
    bgDark: '#0a0a0a', // hitam pekat — overall background
    bgInput: '#2A2018', // coklat gelap — input box background
    bgInputSelected: '#3a301f', // sedikit lebih terang saat selected

    // === TEKS UTAMA ===
    white: '#ffffff',
    black: '#000000',
    khaki: '#E08080', // merah-pink — wordmark NYTHROS & teks penting
    dim: '#888880', // abu — teks sekunder (welcome msg, labels)
    tagline: '#444440', // sangat redup — tagline bawah wordmark

    // === AKSEN ===
    accent: '#E8833A', // oranye — border input, badge, paste indicator, /help

    // === MODE COLORS (badge kiri input & badge GENERAL) ===
    general: '#E8833A', // oranye — mode General
    plan: '#00abad', // teal — mode Plan
    execute: '#cc00ff', // ungu — mode Execute

    // === CHAT COLORS ===
    userText: '#E8833A', // oranye — prefix "You:"
    agentText: '#C8C8C0', // abu terang — teks respons agent
    agentLabel: '#E08080', // merah-pink — label "Nythros:"
    toolText: '#FABD2F', // kuning — tool call notifications
    systemText: '#666660', // abu redup — system messages (/help output dll)

    // === SYNTAX HIGHLIGHTING (ChatView) ===
    codeBlock: '#98C379', // hijau — code block content
    inlineCode: '#E5C07B', // kuning-emas — inline `code`
    toolName: '#C678DD', // ungu — nama tool yang dipanggil
    emphasis: '#E06C75', // merah — warning/error dalam respons
    dimBorder: '#2a2a22', // border subtle code block
  },
};
