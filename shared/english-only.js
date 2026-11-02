// Remarks, notes and anything else that ends up in a report must be in English,
// whatever language the app itself is shown in. Shared by the app (so the person
// can't move on until it's rewritten) and the Worker (so nothing slips past an
// old cached app). A small, free, on-device check -- no AI call:
//   - any non-Latin script (Hindi, Punjabi, Arabic, Cyrillic, Chinese...) is out;
//   - accented letters French, Spanish, Italian and Portuguese use are out;
//   - otherwise, a remark whose everyday words are clearly French / Spanish /
//     Italian / Portuguese (more of them than English ones) is out.
// Words that are also ordinary English ("a", "do", "as", "no", "in"...) are left
// off the foreign lists on purpose so plain English is never blocked.

const NON_LATIN = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿऀ-ॿ਀-੿઀-૿஀-௿฀-๿぀-ヿ㐀-鿿가-힯]/;
const FOREIGN_LETTERS = /[àâäçéèêëîïôöùûüÿñãõáíóúœæ¿¡ºª]/i;

const FOREIGN_WORDS = new Set(
  `le la les des est une et pas avec pour dans sur qui ce cette sont il elle très mais aussi rien tout fait
   el los las es una y con para en por que del muy está están hay pero bien mal sin ya
   lo gli della di che non sono molto anche ma questo questa nella sul
   os um não com em da muito são mas também isso esta este
   fuga fuite perdita vazamento agua eau acqua água bomba pompe pompa caldera chaudière caldaia caldeira
   roto cassé rotto quebrado ruido bruit rumore ruído presión pression pressione pressão
   caliente chaud caldo quente frio froid freddo bueno bon buono bom malo mauvais cattivo ruim
   apagado éteint spento desligado encendido allumé acceso ligado nada todo hoy aujourd'hui oggi hoje
   revisar vérifier controllare verificar problema problème`.split(/\s+/).filter(Boolean),
);

const ENGLISH_WORDS = new Set(
  `the is are was were and of to it its not with for on at this that there have has had be been but
   leak pump pressure boiler valve water hot cold low high running off on normal reading check checked
   replaced broken noise noisy working fine okay ok need needs looks seems today tank level filter
   temperature gauge alarm fan motor belt oil drip dripping open closed`.split(/\s+/).filter(Boolean),
);

export const ENGLISH_ONLY_MESSAGE = "Please write this in English. Remarks and notes go into reports, which must be in English.";

// true when the text reads as English (or is empty).
export function isEnglish(text) {
  const value = String(text ?? "").trim();
  if (!value) return true;
  if (NON_LATIN.test(value)) return false;
  if (FOREIGN_LETTERS.test(value)) return false;
  const words = value.toLowerCase().match(/[a-z']+/g) || [];
  let foreign = 0;
  let english = 0;
  for (const word of words) {
    if (FOREIGN_WORDS.has(word)) foreign += 1;
    if (ENGLISH_WORDS.has(word)) english += 1;
  }
  return !(foreign > 0 && foreign > english);
}
