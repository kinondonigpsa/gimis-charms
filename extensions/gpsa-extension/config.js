// config.js - MIPANGILIO YA KAWAIDA (inasomwa kila extension inapowashwa).
// Jaza mara moja hapa ili usiandike tena kwenye kila kompyuta au kila toleo jipya.
// Kilichowekwa kwenye Settings za extension kinapewa kipaumbele; hapa ni "default" tu.
// USALAMA: faili hii ina siri. Usiitume nje wala usiiweke kwenye GitHub ya umma.
var GPSA_DEFAULTS = {
  geminiApiKey: 'AQ.Ab8RN6Kv8awESQ1ycKYiIDxrZV74k8Cw-iqpO51SMeQNIOeG1A',                       // mfano: 'AQ.Ab8...' au 'AIza...' (kutoka aistudio.google.com/apikey)
  geminiModel: 'gemini-flash-latest',
  groqApiKey: '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',                         // backup AI (bure): console.groq.com/keys
  openrouterApiKey: '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',                   // backup AI (bure): openrouter.ai/keys
  mistralApiKey: '',                      // backup AI: console.mistral.ai/api-keys
  aiPrefer: 'auto',                       // 'auto' (Gemini kwanza, kisha backup) | 'gemini' | 'groq' | 'openrouter' | 'mistral'
  aiCollections: '',                      // tables za Supabase ambazo AI inaruhusiwa KUSOMA (jina kamili la jedwali), mfano: 'fuel_records, receipts'
  // ---- SUPABASE (cloud storage) - JAZA HIZI MBILI (Supabase > Project Settings > API) ----
  supabaseUrl: '',                        // mfano: 'https://abcdxyz.supabase.co'   (Project URL)
  supabaseAnonKey: '',                    // "anon public" key (ni ya umma kwa muundo; ulinzi uko kwenye sign-in + RLS). USITUMIE service_role key hapa!
  supabaseEmail: '',                      // si lazima: ukijaza email + password, extension inaingia Cloud storage yenyewe
  supabasePassword: ''
};
