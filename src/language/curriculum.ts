/**
 * The course plan: six CEFR levels, A1 to C2 (see teaching.ts), each with vocabulary, grammar and theme
 * units in a sensible order. Vocabulary units list the exact English words they teach.
 * Grammar and theme units give a goal, and the on-device model writes example sentences for
 * it, at the level's difficulty, once per language (see languageService).
 * Health and help uses the phone's phrase cards, so it works with no model at all.
 */
import { PHRASES_EN } from '../phrases/data';
import type { LevelId } from './teaching';

export type UnitKind = 'vocab' | 'grammar' | 'theme';

export interface Unit {
  id: string; title: string; icon: string; level: LevelId; kind: UnitKind;
  /** Exact English items (vocabulary); otherwise the model writes items for `goal`. */
  items: string[];
  /** What the unit teaches, for grammar and theme units. */
  goal?: string;
  builtIn?: boolean;
}

const v = (level: LevelId, [id, title, icon]: [string, string, string], items: string[]): Unit => ({ id, title, icon, level, kind: 'vocab', items });
const g = (level: LevelId, [id, title]: [string, string], goal: string): Unit => ({ id, title, icon: 'tool', level, kind: 'grammar', items: [], goal });
const t = (level: LevelId, [id, title, icon]: [string, string, string], goal: string): Unit => ({ id, title, icon, level, kind: 'theme', items: [], goal });

export const UNITS: Unit[] = [
  // A1 Beginner: basic phrases and greetings, in small steps.
  v(1, ['basics', 'Basics', 'smile'], ['hello', 'goodbye', 'please', 'thank you', 'yes', 'no', 'sorry', 'excuse me']),
  v(1, ['intro', 'Meeting people', 'users'], ['What is your name?', 'My name is Sam.', 'Nice to meet you.', 'How are you?', 'I am fine.', 'Where are you from?', 'I speak a little.', 'I do not understand.']),
  g(1, ['g-be', 'To be and to have'], 'saying who and what things are, and what you have: I am, you are, it is, I have, we have'),
  v(1, ['numbers', 'Numbers 1-10', 'hash'], ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']),
  g(1, ['g-articles', 'The, a and plurals'], 'articles (the, a), noun gender if the language has it, and making nouns plural'),
  v(1, ['colors', 'Colours', 'droplet'], ['red', 'blue', 'green', 'yellow', 'black', 'white', 'The car is red.', 'My favourite colour is blue.']),
  v(1, ['family', 'Family', 'heart'], ['mother', 'father', 'friend', 'child', 'brother', 'sister', 'my family', 'I have two children.']),
  g(1, ['g-present', 'Everyday verbs now'], 'present tense of everyday verbs (eat, drink, live, work, go, want) for I, you, he, she, we, they'),
  v(1, ['food', 'Food and drink', 'coffee'], ['water', 'bread', 'coffee', 'tea', 'I am hungry.', 'The bill, please.', 'I would like a coffee.', 'It is delicious.']),
  v(1, ['fruit', 'Fruit and vegetables', 'shopping-cart'], ['apple', 'banana', 'orange', 'tomato', 'potato', 'onion', 'I like apples.', 'Two kilos of potatoes, please.']),
  g(1, ['g-questions', 'Questions and no'], 'asking questions (what, where, who, when, how much) and saying no or not'),
  v(1, ['time', 'Time and days', 'clock'], ['today', 'tomorrow', 'yesterday', 'morning', 'night', 'What time is it?', 'Monday', 'the weekend']),
  v(1, ['days', 'Days and months', 'calendar'], ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'January', 'June', 'My birthday is in May.', 'See you on Friday.']),
  g(1, ['g-possessive', 'My, your, his'], 'possessives: my, your, his, her, our, their, with family and things'),
  v(1, ['animals', 'Animals', 'feather'], ['dog', 'cat', 'bird', 'horse', 'fish', 'cow', 'I have a dog.', 'The cat is sleeping.']),
  v(1, ['body', 'The body', 'user'], ['head', 'hand', 'foot', 'eye', 'mouth', 'back', 'My head hurts.', 'Wash your hands.']),
  v(1, ['clothes', 'Clothes', 'shopping-bag'], ['shirt', 'trousers', 'shoes', 'dress', 'jacket', 'hat', 'I need a bigger size.', 'Can I try it on?']),
  g(1, ['g-like', 'I like, I want'], 'likes and wants: I like, I do not like, I want, I need, I can, followed by a verb or a thing'),
  v(1, ['weather', 'Weather', 'cloud'], ['sun', 'rain', 'snow', 'wind', 'hot', 'cold', 'It is raining.', 'It is very hot today.']),
  v(1, ['feelings', 'Feelings', 'smile'], ['happy', 'sad', 'tired', 'angry', 'bored', 'scared', 'I am very happy.', 'Are you tired?']),
  v(1, ['polite', 'Being polite', 'smile'], ['Good morning.', 'Good afternoon.', 'Good night.', 'See you later.', 'You are welcome.', 'No problem.', 'Of course.', 'Excuse me, please.']),
  v(1, ['classroom', 'In class', 'book'], ['pen', 'book', 'table', 'chair', 'door', 'window', 'Open the book.', 'Repeat, please.']),
  v(1, ['house-a1', 'My house', 'home'], ['house', 'room', 'kitchen', 'bed', 'bathroom', 'garden', 'My house is small.', 'Come in.']),
  v(1, ['breakfast', 'Breakfast', 'coffee'], ['milk', 'egg', 'cheese', 'butter', 'juice', 'sugar', 'I eat breakfast at eight.', 'Do you want milk?']),
  { id: 'help', title: 'Health and help', icon: 'life-buoy', level: 1, kind: 'vocab', items: PHRASES_EN.slice(0, 12), builtIn: true },
  // A2 Elementary: everyday expressions for shopping, directions, work and plans.
  v(2, ['numbers2', 'Numbers 11-100', 'hash'], ['eleven', 'twelve', 'fifteen', 'twenty', 'thirty', 'fifty', 'one hundred', 'I am twenty-five years old.']),
  g(2, ['g-adjectives', 'Big, small, good'], 'adjectives after and before nouns, and making them agree (big house, small houses)'),
  v(2, ['directions', 'Directions', 'compass'], ['left', 'right', 'straight ahead', 'near', 'far', 'Where is the station?', 'Where is the bathroom?', 'Turn left here.']),
  g(2, ['g-there-is', 'There is, there are'], 'saying what there is in a place: there is a ..., there are two ..., is there ...?'),
  v(2, ['city', 'In town', 'map-pin'], ['the bank', 'the shop', 'the park', 'the hospital', 'the school', 'the street', 'The bank is next to the park.', 'Is there a pharmacy near here?']),
  v(2, ['shopping', 'Shopping', 'shopping-bag'], ['How much is it?', 'too expensive', 'I will take it.', 'cash', 'card', 'open', 'closed', 'the market']),
  g(2, ['g-place', 'In, on, under'], 'prepositions of place: in, on, under, next to, between, in front of, behind'),
  v(2, ['transport', 'Getting around', 'navigation'], ['car', 'bike', 'taxi', 'metro', 'on foot', 'one ticket', 'Where does this bus go?', 'I am going by train.']),
  v(2, ['travel', 'Travel', 'map'], ['hotel', 'ticket', 'airport', 'bus', 'train', 'passport', 'Where is the bus stop?', 'I have a reservation.']),
  v(2, ['hobbies', 'Free time', 'music'], ['music', 'films', 'football', 'reading', 'to swim', 'to cook', 'I like to read.', 'What do you do at the weekend?']),
  g(2, ['g-past-simple', 'Yesterday'], 'the simple past of the most common verbs: I went, I ate, I saw, I bought, I had, it was'),
  v(2, ['jobs', 'Jobs', 'briefcase'], ['teacher', 'doctor', 'driver', 'cook', 'nurse', 'student', 'I work in an office.', 'What do you do?']),
  v(2, ['my-day', 'My day', 'sun'], ['to wake up', 'to have breakfast', 'to go to work', 'to come home', 'to have dinner', 'to go to bed', 'I get up at seven.', 'I go to bed late.']),
  g(2, ['g-going-to', 'Going to'], 'the near future: I am going to, are you going to, with time words like tonight and next week'),
  v(2, ['cafe', 'At the cafe', 'coffee'], ['a table for two', 'the menu', 'a glass of water', 'the dessert', 'a sandwich', 'soup', 'Can I pay by card?', 'Another coffee, please.']),
  v(2, ['seasons', 'Seasons', 'sun'], ['spring', 'summer', 'autumn', 'winter', 'the sea', 'the mountains', 'In summer we go to the beach.', 'I love winter.']),
  g(2, ['g-can', 'Can and cannot'], 'ability and permission: I can swim, can I sit here?, you cannot park here'),
  v(2, ['sports-a2', 'Sports', 'activity'], ['football', 'tennis', 'swimming', 'running', 'the team', 'to win', 'Do you play tennis?', 'We won the match.']),
  v(2, ['ill', 'Feeling ill', 'thermometer'], ['a cold', 'a fever', 'a cough', 'medicine', 'the pharmacy', 'the doctor', 'I feel ill.', 'I need a doctor.']),
  g(2, ['g-often', 'Always, sometimes, never'], 'how often: always, usually, sometimes, never, every day, once a week, and where these words go'),
  v(2, ['devices', 'Phone and computer', 'smartphone'], ['phone', 'computer', 'the internet', 'password', 'to send', 'message', 'My phone has no battery.', 'Send me a message.']),
  v(2, ['plans', 'Making plans', 'calendar'], ['Are you free on Saturday?', 'Let us meet at six.', 'Good idea.', 'I cannot, sorry.', 'Where shall we meet?', 'See you there.', 'What time?', 'Maybe next week.']),
  v(2, ['celebrate', 'Celebrations', 'gift'], ['party', 'present', 'cake', 'Happy birthday.', 'Congratulations.', 'Cheers.', 'We are celebrating.', 'Happy new year.']),
  v(2, ['countries', 'Countries and languages', 'globe'], ['country', 'language', 'Spain', 'England', 'Mexico', 'I am English.', 'She speaks French.', 'I live in London.']),
  g(2, ['g-compare-a2', 'Bigger, smaller'], 'simple comparisons: bigger, smaller, more expensive, cheaper than, the same as'),
  v(2, ['home-jobs', 'Housework', 'home'], ['to clean', 'to wash', 'to cook', 'to tidy', 'the dishes', 'the rubbish', 'I clean on Saturday.', 'Can you help me?']),
  // B1 Intermediate: familiar topics and travel, telling stories and plans.
  g(3, ['g-past', 'What happened'], 'the past tense: saying what you did yesterday, last week and last year'),
  t(3, ['routine', 'Daily routine', 'sun'], 'describing a normal day: waking up, work or school, meals, evenings, with time words'),
  g(3, ['g-used-to', 'When I was young'], 'talking about past habits and descriptions (I used to, it was, we would), and how they differ from single past events'),
  g(3, ['g-future', 'Plans'], 'talking about the future and plans: going to, will, next week, tomorrow'),
  t(3, ['home', 'Home and furniture', 'home'], 'rooms and furniture (table, chair, bed, sofa, kitchen) and saying where things are'),
  g(3, ['g-now', 'Right now'], 'actions happening now (I am cooking, she is working) compared with habits'),
  t(3, ['kitchen', 'Cooking', 'coffee'], 'kitchen things, ingredients and following a simple recipe (cut, boil, mix, add)'),
  g(3, ['g-compare', 'Bigger and better'], 'comparing things: more, less, bigger, better, the best, as ... as'),
  t(3, ['health', 'At the doctor', 'activity'], 'describing how you feel, body parts, symptoms and following advice'),
  g(3, ['g-pronouns', 'It, him, her, them'], 'object pronouns and reflexive verbs (I get up, I wash myself) in everyday sentences'),
  t(3, ['restaurant', 'Eating out', 'coffee'], 'ordering, asking about dishes, allergies, paying and giving a short opinion of a meal'),
  g(3, ['g-commands', 'Do this, do not do that'], 'commands and polite requests: come here, do not touch, could you, please'),
  t(3, ['hotel', 'At the hotel', 'key'], 'booking a room, checking in and out, asking for things and reporting problems'),
  t(3, ['travel-problems', 'Travel problems', 'alert-circle'], 'missed trains, lost bags, delays, asking for help and changing tickets'),
  g(3, ['g-modals', 'Must, should, can'], 'obligation and advice: must, have to, should, can, may, not allowed'),
  t(3, ['work', 'Work and study', 'briefcase'], 'jobs, the workplace, school subjects and talking about what you do'),
  t(3, ['phone', 'On the phone', 'phone'], 'phone calls and messages: leaving a message, making an appointment, spelling your name'),
  g(3, ['g-time', 'Since, for, ago'], 'time expressions: since, for, ago, already, yet, still, just'),
  t(3, ['sports', 'Sport and fitness', 'activity'], 'sports, the gym, matches and talking about how often you exercise'),
  t(3, ['nature', 'In the countryside', 'feather'], 'mountains, rivers, trees, the beach, camping and the seasons'),
  t(3, ['services', 'Bank and post office', 'credit-card'], 'opening an account, sending a parcel, changing money, filling in a form'),
  g(3, ['g-connectors', 'Because, but, so'], 'joining ideas: because, but, so, when, if, although, then'),
  t(3, ['personality', 'What people are like', 'users'], 'describing people: looks, personality, habits, likes and dislikes'),
  t(3, ['emergency', 'Emergencies', 'alert-triangle'], 'accidents, calling for help, the police, describing what happened and where you are'),
  t(3, ['renting', 'Renting a flat', 'key'], 'finding a flat, viewing it, the rent, bills, the landlord and reporting something broken'),
  t(3, ['complaints', 'Returns and complaints', 'rotate-ccw'], 'returning something, asking for a refund, complaining politely and getting it fixed'),
  g(3, ['g-verb-patterns', 'Like doing, want to do'], 'verb patterns: like doing, want to do, stop doing, try to do, and verbs with to or -ing forms'),
  t(3, ['festivals', 'Festivals and holidays', 'gift'], 'festivals and public holidays, what people do, eat and wear, and your favourite one'),
  t(3, ['friends', 'Making friends', 'users'], 'meeting new people, small talk, invitations, keeping in touch'),
  t(3, ['driving', 'Driving and the car', 'navigation'], 'hiring a car, petrol, parking, road signs, a breakdown and asking the way'),
  // B2 Upper intermediate: complex texts and news, opinions and fluent conversation.
  g(4, ['g-conditional', 'Would and if'], 'the conditional (would) and if-sentences about possible and imagined situations'),
  t(4, ['opinions', 'Giving opinions', 'message-square'], 'agreeing, disagreeing politely, giving reasons and examples'),
  g(4, ['g-subjunctive', 'Wishes and doubts'], 'wishes, doubts, advice and emotions (the subjunctive where the language has one)'),
  t(4, ['news', 'In the news', 'globe'], 'common news topics: weather, economy, elections, science, sport results, with news-style phrasing'),
  g(4, ['g-perfect', 'Had done, will have done'], 'past perfect and future perfect: what had happened before, what will have happened by then'),
  t(4, ['job-interview', 'Job interview', 'briefcase'], 'describing experience and skills, answering interview questions, asking about the job'),
  g(4, ['g-passive', 'It was made'], 'the passive voice and relative clauses (which, who, where) in descriptions'),
  t(4, ['environment', 'Nature and the environment', 'feather'], 'climate, recycling, nature and discussing problems and solutions'),
  g(4, ['g-reported', 'She said that'], 'reported speech: telling what someone said, asked or told you to do'),
  t(4, ['technology', 'Technology', 'smartphone'], 'phones, the internet, apps and talking about how technology changes life'),
  t(4, ['money', 'Money and banking', 'dollar-sign'], 'budgets, saving, loans, prices, rent and complaining about a bill'),
  g(4, ['g-if-past', 'If I had known'], 'if-sentences about the past and regrets: if I had known, I would have'),
  t(4, ['relationships', 'Relationships', 'heart'], 'friendship, dating, family conflicts, apologising and making up'),
  t(4, ['media', 'Media and social media', 'tv'], 'films, series, influencers, fake news, reviews and recommending something'),
  g(4, ['g-linking', 'However and therefore'], 'linking ideas in longer speech: however, therefore, despite, whereas, as a result, in addition'),
  t(4, ['education', 'Education', 'book'], 'school systems, university, exams, learning styles and lifelong learning'),
  t(4, ['society', 'Society and politics', 'flag'], 'elections, laws, rights, public services and discussing them calmly'),
  t(4, ['science', 'Science and health', 'activity'], 'research, medicine, the body, healthy habits and explaining a discovery simply'),
  t(4, ['meetings', 'Meetings and emails', 'mail'], 'taking part in meetings, writing clear work emails, agreeing next steps'),
  t(4, ['travel-tales', 'Travel stories', 'map'], 'telling a travel story well: setting the scene, what went wrong, how it ended'),
  g(4, ['g-probably', 'Might, must have'], 'probability and deduction: might, may, could, must have, cannot have, will probably'),
  t(4, ['neighbours', 'Housing and neighbours', 'home'], 'buying or renting, neighbours, noise, community rules and solving a dispute'),
  t(4, ['diet', 'Food and diet', 'coffee'], 'healthy eating, diets, food culture, cooking at home and eating out'),
  g(4, ['g-verb-prep', 'Depend on, think about'], 'verbs, adjectives and nouns that take a fixed preposition (depend on, interested in, reason for)'),
  t(4, ['competition', 'Sport and competition', 'award'], 'big sporting events, fans, fair play, winning and losing, commenting on a match'),
  // C1 Advanced: social, academic and professional language, nuance and register.
  t(5, ['idioms', 'Idioms', 'zap'], 'common idioms and fixed expressions, with what they really mean'),
  g(5, ['g-register', 'Formal and casual'], 'the same message said formally (letters, officials) and casually (friends), and when to use each'),
  t(5, ['culture', 'Culture and customs', 'flag'], 'customs, holidays, food traditions and manners where the language is spoken'),
  t(5, ['slang', 'Slang and everyday speech', 'message-circle'], 'common informal words, fillers and abbreviations people really use, and when not to use them'),
  t(5, ['debate', 'Debate', 'mic'], 'arguing a point precisely: hedging, conceding, contrasting and concluding'),
  g(5, ['g-nuance', 'Saying it precisely'], 'nuance: near-synonyms, tone, emphasis and connectors that change meaning'),
  t(5, ['business', 'Business and negotiation', 'briefcase'], 'meetings, proposals, negotiating, persuading and writing a professional email'),
  t(5, ['law', 'Law and rights', 'shield'], 'contracts, tenants and consumers, the courts and explaining your rights'),
  g(5, ['g-advanced-subj', 'If only, as if'], 'advanced subjunctive and unreal forms: if only, as if, it is time that, whoever, wherever'),
  t(5, ['academic', 'Academic writing', 'file-text'], 'essays and reports: structuring an argument, citing, cautious language and formal connectors'),
  t(5, ['presenting', 'Giving a presentation', 'mic'], 'opening, signposting, handling questions and closing a talk'),
  t(5, ['economy', 'The economy', 'trending-up'], 'inflation, jobs, trade, taxes and explaining economic news'),
  t(5, ['psychology', 'Mind and behaviour', 'cpu'], 'habits, motivation, stress, memory and how people make decisions'),
  t(5, ['healthcare', 'Healthcare', 'activity'], 'health systems, appointments, specialists, describing symptoms precisely and patient rights'),
  g(5, ['g-cleft', 'What I mean is'], 'cleft sentences and fronting for emphasis: what I need is, it was she who, the thing is'),
  t(5, ['cities', 'Cities and planning', 'map'], 'transport, housing, green spaces and how a city should grow'),
  t(5, ['tech-ethics', 'Technology and ethics', 'shield'], 'privacy, artificial intelligence, work and automation, arguing both sides'),
  // C2 Proficient: understand almost everything, with fine shades of meaning.
  t(6, ['humour', 'Humour and wordplay', 'smile'], 'jokes, puns, irony and sarcasm, and how humour differs between cultures'),
  t(6, ['history', 'History', 'clock'], 'important events in the history of places where the language is spoken, told in narrative past tenses'),
  t(6, ['arts', 'Art, music and film', 'music'], 'describing and reviewing art, music and film with rich, precise vocabulary'),
  g(6, ['g-style', 'Style and emphasis'], 'stylistic word order, emphasis and inversion (never have I ...), and discourse markers'),
  t(6, ['philosophy', 'Big questions', 'help-circle'], 'ethics, happiness, freedom and the meaning of life, discussed with abstract vocabulary'),
  t(6, ['regional', 'Regional differences', 'map'], 'how the language changes between countries and regions: words, accents and expressions'),
  t(6, ['literature', 'Stories and literature', 'book'], 'describing stories, characters and feelings with rich, literary vocabulary'),
  t(6, ['poetry', 'Poetry and song lyrics', 'feather'], 'reading poems and lyrics: imagery, rhythm, double meanings'),
  t(6, ['proverbs', 'Proverbs and sayings', 'book-open'], 'common proverbs and sayings, what they mean and when people use them'),
  t(6, ['press', 'Reading between the lines', 'file-text'], 'bias, implied meaning and tone in newspapers and opinion pieces'),
  t(6, ['speeches', 'Famous speeches', 'mic'], 'rhetoric in well-known speeches: repetition, contrast, appeals and rhythm'),
  t(6, ['diplomacy', 'Diplomatic language', 'globe'], 'softening, implying and saying no politely in formal and tense situations'),
  g(6, ['g-literary', 'Literary and formal forms'], 'literary and old-fashioned forms still met in books, law and ceremonies, and their everyday equivalents'),
  t(6, ['untranslatable', 'Hard to translate', 'help-circle'], 'words and expressions with no simple English equivalent, and how to explain them'),
  t(6, ['science-c2', 'Science explained', 'zap'], 'explaining complex scientific ideas precisely to a general audience'),
  t(6, ['wordplay', 'Puns and wordplay', 'smile'], 'puns, double meanings, tongue twisters and playful language'),
];

export const unitById = (id: string) => UNITS.find((u) => u.id === id);
export const unitsForLevel = (level: LevelId) => UNITS.filter((u) => u.level === level);
export const KIND_LABEL: Record<UnitKind, string> = { vocab: 'Vocabulary', grammar: 'Grammar', theme: 'Theme' };
