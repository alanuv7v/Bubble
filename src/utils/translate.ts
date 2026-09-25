import STATES from "../STATES"
import translations from "../translations"

export default function (original: string) {
  return (STATES.language === "en" || !(translations[original])) ? 
    original
    : (translations[original][STATES.language] ?? original)
}