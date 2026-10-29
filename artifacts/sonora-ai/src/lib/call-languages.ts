export const CALL_LANGUAGES = [
  { name: "English", browser: "en-US" },
  { name: "Spanish", browser: "es-ES" },
  { name: "French", browser: "fr-FR" },
  { name: "German", browser: "de-DE" },
  { name: "Italian", browser: "it-IT" },
  { name: "Portuguese", browser: "pt-PT" },
  { name: "Dutch", browser: "nl-NL" },
  { name: "Polish", browser: "pl-PL" },
  { name: "Russian", browser: "ru-RU" },
  { name: "Ukrainian", browser: "uk-UA" },
  { name: "Japanese", browser: "ja-JP" },
  { name: "Korean", browser: "ko-KR" },
  { name: "Mandarin", browser: "zh-CN" },
  { name: "Arabic", browser: "ar-SA" },
  { name: "Hindi", browser: "hi-IN" },
  { name: "Turkish", browser: "tr-TR" },
  { name: "Swedish", browser: "sv-SE" },
  { name: "Danish", browser: "da-DK" },
  { name: "Norwegian", browser: "nb-NO" },
  { name: "Finnish", browser: "fi-FI" },
  { name: "Czech", browser: "cs-CZ" },
  { name: "Greek", browser: "el-GR" },
  { name: "Hebrew", browser: "he-IL" },
  { name: "Hungarian", browser: "hu-HU" },
  { name: "Romanian", browser: "ro-RO" },
  { name: "Indonesian", browser: "id-ID" },
  { name: "Malay", browser: "ms-MY" },
  { name: "Vietnamese", browser: "vi-VN" },
  { name: "Thai", browser: "th-TH" },
  { name: "Bulgarian", browser: "bg-BG" },
  { name: "Catalan", browser: "ca-ES" },
  { name: "Croatian", browser: "hr-HR" },
  { name: "Slovak", browser: "sk-SK" },
  { name: "Tamil", browser: "ta-IN" },
  { name: "Urdu", browser: "ur-PK" },
] as const;

export type CallLanguage = (typeof CALL_LANGUAGES)[number]["name"];

export function browserLanguage(language: string | undefined) {
  return CALL_LANGUAGES.find(item => item.name === language)?.browser ?? "en-US";
}
