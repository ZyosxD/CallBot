const faqs = [
  {
    question: "What are your opening hours?",
    keywords: ["hours", "open", "close", "time"],
    answer: "We are open from Monday to Friday, 9 AM to 5 PM."
  },
  {
    question: "Where are you located?",
    keywords: ["location", "address", "where"],
    answer: "We are located at 123 Main Street, Springfield."
  },
  {
    question: "Do you accept insurance?",
    keywords: ["insurance", "payment", "cost"],
    answer: "Yes, we accept most major insurance plans."
  }
];

export const getFAQAnswer = (userQuery) => {
  const lowerQuery = userQuery.toLowerCase();

  // Simple keyword matching
  let bestMatch = null;
  let maxKeywords = 0;

  for (const faq of faqs) {
    let matchCount = 0;
    for (const keyword of faq.keywords) {
      if (lowerQuery.includes(keyword)) {
        matchCount++;
      }
    }
    if (matchCount > maxKeywords) {
      maxKeywords = matchCount;
      bestMatch = faq;
    }
  }

  if (bestMatch) {
    return bestMatch.answer;
  }
  return null;
};
