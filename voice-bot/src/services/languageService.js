// This service is used to detect language and manage session language state.
// Since OpenAI Realtime API handles audio directly, we primarily rely on the system prompt
// to instruct the model to detect and switch languages.
// However, we can add explicit logic here if we were processing text transcripts manually.

export const detectLanguage = (text) => {
  // Simple heuristic detection (could be replaced by a library or API)
  const spanishKeywords = ['hola', 'gracias', 'adiós', 'cita', 'ayuda'];
  const lowerText = text.toLowerCase();

  for (const word of spanishKeywords) {
    if (lowerText.includes(word)) {
      return 'es';
    }
  }
  return 'en';
};

export const getSystemPromptForLanguage = (language) => {
  if (language === 'es') {
    return "Eres un asistente útil y educado. Hablas español.";
  }
  return "You are a helpful and polite assistant. You speak English.";
};
