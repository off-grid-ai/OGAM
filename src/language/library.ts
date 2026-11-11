/**
 * Pre-made stories and podcasts for the course: simplified fairy tales and fables, funny
 * everyday moments, friends talking, and news (made-up, historical, and today's real
 * headlines). Each piece has an English outline; some are written out in full for Spanish,
 * and the rest are written once by the AI on the phone at the learner's level, then kept.
 * Story and podcast squares on the board land on these, in order. Pure data and lookups.
 */
import { boardFor } from './board';
import type { Listening } from './listening';
import type { LevelId } from './teaching';

export type Genre = 'fairy' | 'fable' | 'daily' | 'chat' | 'travel' | 'news-fake' | 'news-history' | 'news-real';

export interface Premade {
  id: string;
  kind: Listening['kind'];
  genre: Genre;
  title: string;
  level: LevelId;
  /** What happens, in English: the AI retells this at the learner's level. */
  outline: string;
}

export const GENRES: { genre: Genre; kind: Listening['kind']; title: string; icon: string }[] = [
  { genre: 'fairy', kind: 'story', title: 'Fairy tales', icon: 'feather' },
  { genre: 'fable', kind: 'story', title: 'Fables', icon: 'sunrise' },
  { genre: 'daily', kind: 'story', title: 'Funny everyday moments', icon: 'smile' },
  { genre: 'chat', kind: 'podcast', title: 'Friends talking', icon: 'message-circle' },
  { genre: 'travel', kind: 'podcast', title: 'Places and culture', icon: 'map' },
  { genre: 'news-real', kind: 'podcast', title: 'Today\'s real news', icon: 'radio' },
  { genre: 'news-fake', kind: 'podcast', title: 'Made-up news', icon: 'coffee' },
  { genre: 'news-history', kind: 'podcast', title: 'News from history', icon: 'clock' },
];

type Entry = [id: string, title: string, outline: string];
const story = (genre: Genre, level: LevelId, [id, title, outline]: Entry): Premade => ({ id, kind: 'story', genre, level, title, outline });
const pod = (genre: Genre, level: LevelId, [id, title, outline]: Entry): Premade => ({ id, kind: 'podcast', genre, level, title, outline });

/** The id of the one live piece: today's real headlines, read as a short bulletin. */
export const REAL_NEWS = 'news-real-today';

export const LIBRARY: Premade[] = [
  // Fairy tales, simplified.
  story('fairy', 1, ['three-pigs', 'The three little pigs', 'Three pigs build houses of straw, sticks and bricks. A wolf blows down the straw and stick houses. He cannot blow down the brick house. The pigs are safe together.']),
  story('fairy', 1, ['goldilocks', 'Goldilocks and the three bears', 'A girl finds a house in the woods. She tries three bowls of soup, three chairs and three beds: too hot, too cold, just right. The bears come home and she runs away.']),
  story('fairy', 1, ['red-riding-hood', 'Little Red Riding Hood', 'A girl in a red hood takes food to her grandmother. A wolf gets there first and wears grandmother\'s clothes. "What big eyes you have." A woodcutter helps and everyone is fine.']),
  story('fairy', 2, ['gingerbread', 'The gingerbread man', 'A woman bakes a gingerbread man. He jumps up and runs away: "You cannot catch me." Many animals chase him. A clever fox offers to carry him over the river.']),
  story('fairy', 3, ['cinderella', 'Cinderella', 'A kind girl works for her stepmother. A fairy gives her a dress and a coach for the prince\'s party, until midnight. She runs and loses a shoe. The prince finds her with the shoe.']),
  story('fairy', 3, ['hansel-gretel', 'Hansel and Gretel', 'A brother and sister get lost in the forest. They find a house made of sweets. A witch lives there. Gretel tricks the witch and they find their way home.']),
  story('fairy', 3, ['jack-beanstalk', 'Jack and the beanstalk', 'Jack sells the cow for magic beans. A giant beanstalk grows. At the top lives a giant with a goose that lays golden eggs. Jack takes the goose and cuts down the beanstalk.']),
  story('fairy', 3, ['ugly-duckling', 'The ugly duckling', 'A strange grey bird is born with ducklings. The others laugh at him. He is alone all winter. In spring he sees his face in the water: he is a beautiful swan.']),
  story('fairy', 4, ['snow-white', 'Snow White', 'A queen asks her mirror who is the most beautiful. The answer is Snow White, so she must hide. She lives with seven small miners. The queen brings a poisoned apple.']),
  story('fairy', 4, ['emperors-clothes', 'The emperor\'s new clothes', 'Two tricksters sell an emperor "magic" cloth that foolish people cannot see. Nobody wants to look foolish. In the parade, a child says: he has no clothes.']),
  story('fairy', 4, ['sleeping-beauty', 'Sleeping Beauty', 'A princess is cursed to sleep for a hundred years when she touches a spindle. A forest grows around the castle. A prince finds the way in and the whole castle wakes.']),
  story('fairy', 6, ['pied-piper', 'The piper of Hamelin', 'A town full of rats hires a piper. His music leads the rats away. The town refuses to pay. He plays again and the children follow him. A story about keeping promises.']),
  story('fairy', 2, ['frog-prince', 'The frog prince', 'A princess drops her golden ball in a well. A frog brings it back if she will be his friend. She does not keep her promise at first. When she does, the frog becomes a prince.']),
  story('fairy', 2, ['stone-soup', 'Stone soup', 'Hungry travellers arrive in a village where nobody shares. They put a stone in a pot of water and say it makes great soup. Each villager adds one thing. Everyone eats together.']),
  story('fairy', 3, ['puss-in-boots', 'Puss in Boots', 'A poor young man gets only a cat. The clever cat asks for boots, tricks a king and an ogre, and wins his master a castle and a princess.']),
  story('fairy', 3, ['rapunzel', 'Rapunzel', 'A girl with very long hair is locked in a tower. A prince climbs up her hair. When the witch finds out, they are separated, but they find each other again.']),
  story('fairy', 3, ['pinocchio', 'Pinocchio', 'A carpenter makes a wooden puppet that comes to life. When Pinocchio lies, his nose grows. After many adventures he learns to be honest and becomes a real boy.']),
  story('fairy', 4, ['rumpelstiltskin', 'Rumpelstiltskin', 'A miller boasts his daughter can spin straw into gold. A strange little man does it for her, for a terrible price, unless she can guess his name.']),
  story('fairy', 4, ['aladdin', 'Aladdin and the lamp', 'A poor young man finds an old lamp with a genie inside. He gets riches and marries a princess, but a sorcerer tricks the princess into giving the lamp away.']),
  story('fairy', 5, ['beauty-beast', 'Beauty and the Beast', 'To save her father, Belle lives in the castle of a frightening beast. She sees his kindness, and her love breaks the spell that made him a beast.']),
  story('fairy', 6, ['little-mermaid', 'The little mermaid', 'A young mermaid gives up her voice to have legs and be with a prince on land. The original ending is bittersweet: a story about sacrifice and what love asks of us.']),
  // Fables.
  story('fable', 1, ['tortoise-hare', 'The tortoise and the hare', 'A fast hare laughs at a slow tortoise. They race. The hare sleeps under a tree. The tortoise keeps walking and wins. Slow and steady wins.']),
  story('fable', 2, ['lion-mouse', 'The lion and the mouse', 'A lion catches a mouse and lets it go. Later the lion is caught in a net. The mouse bites the net and frees him. Small friends can help.']),
  story('fable', 3, ['boy-wolf', 'The boy who cried wolf', 'A bored shepherd boy shouts "Wolf." The villagers run to help, but there is no wolf. He does it again. When a real wolf comes, nobody believes him.']),
  story('fable', 3, ['ant-grasshopper', 'The ant and the grasshopper', 'All summer the ant works and stores food. The grasshopper sings and plays. In winter the grasshopper is hungry and asks the ant for help.']),
  story('fable', 4, ['fox-grapes', 'The fox and the grapes', 'A fox sees grapes high on a vine. He jumps and jumps but cannot reach them. He walks away saying they are sour anyway.']),
  story('fable', 4, ['milkmaid', 'The milkmaid and her pail', 'A girl carries milk to market and dreams: milk, then eggs, then chickens, then a new dress. She tosses her head and the milk falls. Do not count your chickens.']),
  story('fable', 1, ['crow-pitcher', 'The crow and the water', 'A thirsty crow finds a jug with a little water at the bottom. It cannot reach it. It drops in stones one by one until the water comes up, and it drinks.']),
  story('fable', 1, ['dog-shadow', 'The dog and its reflection', 'A dog carries a bone over a bridge. It sees another dog with a bone in the water. It barks to take that bone too, and its own bone falls into the river.']),
  story('fable', 2, ['town-mouse', 'The town mouse and the country mouse', 'A country mouse visits his cousin in the city. There is fine food but also cats and danger. He goes home happy with simple food and peace.']),
  story('fable', 2, ['golden-goose', 'The goose with the golden eggs', 'A farmer has a goose that lays one golden egg a day. He wants all the gold at once, so he kills the goose, and finds nothing inside.']),
  story('fable', 3, ['wind-sun', 'The wind and the sun', 'The wind and the sun argue about who is stronger. They try to make a traveller take off his coat. The wind blows hard and he holds it tight; the sun shines and he takes it off.']),
  story('fable', 4, ['wolf-sheep', 'The wolf in sheep\'s clothing', 'A wolf hides in a sheepskin to get close to the flock. It works until the shepherd chooses a sheep for dinner. Appearances can deceive.']),
  // Funny everyday moments.
  story('daily', 1, ['wrong-coffee', 'The wrong coffee', 'Sam orders a small black coffee. The waiter brings a huge hot chocolate with cream. Sam is too shy to say anything, drinks it all, and orders a coffee again.']),
  story('daily', 1, ['lost-keys', 'Where are my keys?', 'Ana is late for work. She looks for her keys in the kitchen, the bedroom, the bathroom and the car. Her daughter laughs: the keys are in her hand.']),
  story('daily', 2, ['dog-sandwich', 'The dog and the sandwich', 'Leo makes a big sandwich and goes to answer the phone. When he comes back the plate is empty. The dog looks at him with big innocent eyes and bread on its nose.']),
  story('daily', 2, ['wrong-bus', 'The wrong bus', 'Maria takes bus 15 to the beach. After an hour she sees mountains, not the sea. She took bus 51. She has a lovely day in the mountains instead.']),
  story('daily', 3, ['haircut', 'The haircut', 'Tom asks for "just a little shorter". He looks at his phone during the haircut. When he looks up, he has almost no hair. His friends say he looks younger.']),
  story('daily', 3, ['gps', 'The GPS knows best', 'A family follows the car GPS on holiday. It sends them down a farm road, into a field and to a river. A farmer with a tractor helps them and invites them to lunch.']),
  story('daily', 3, ['cooking-show', 'Cooking for the in-laws', 'Paula cooks dinner for her partner\'s parents for the first time. Everything burns. She orders pizza and serves it on her best plates. They ask for the recipe.']),
  story('daily', 3, ['video-call', 'The video call', 'Marco has a work video call from home. He wears a shirt and tie, and pyjama shorts. The doorbell rings, he stands up, and everyone sees.']),
  story('daily', 4, ['language-mixup', 'A small mix-up', 'A tourist tries to say "I am embarrassed" in Spanish and says "I am pregnant" (embarazada). The shopkeeper congratulates him. A lesson about false friends.']),
  story('daily', 4, ['neighbours-parcel', 'The neighbour\'s parcel', 'Clara takes in a parcel for a neighbour she has never met. It starts to move and make noises. It is a puppy. The neighbour and Clara become friends.']),
  story('daily', 5, ['job-interview', 'The job interview', 'Javier rushes to an interview and argues with a man about a parking space. He arrives at the interview. The man from the car park is the boss.']),
  story('daily', 6, ['smart-home', 'The smart house', 'Elena buys a smart speaker that controls the house. It misunderstands everything: it orders forty bananas, plays opera at 3 a.m. and locks her out. She goes back to light switches.']),
  story('daily', 1, ['phone-fridge', 'The phone in the fridge', 'Lucia cannot find her phone. She calls it from her friend\'s phone. It rings in the fridge, next to the milk.']),
  story('daily', 1, ['wrong-name', 'The wrong name', 'At a party, Pablo says hello to a woman: "Hi, Laura." She is not Laura. They laugh, talk all night, and become good friends.']),
  story('daily', 2, ['umbrella', 'The umbrella', 'Every day Rosa takes her umbrella and it does not rain. The one day she leaves it at home, there is a storm. A stranger shares his umbrella with her.']),
  story('daily', 2, ['diet-cake', 'The diet', 'Diego starts a diet on Monday. On Monday afternoon a colleague brings a chocolate cake for her birthday. Diego starts his diet again on Tuesday.']),
  story('daily', 3, ['gym-first-day', 'First day at the gym', 'Ines joins a gym. She does not know how the machines work, goes the wrong way on the treadmill, and ends up teaching a class by mistake.']),
  story('daily', 3, ['self-checkout', 'The self-checkout', 'Carlos tries the self-service till at the supermarket. "Unexpected item in the bagging area." Every time. In the end the whole queue helps him.']),
  story('daily', 4, ['karaoke', 'Karaoke night', 'Nuria hates singing in public. Her friends put her name on the karaoke list. The song starts, she is terrified, and then she wins the night.']),
  story('daily', 5, ['autocorrect', 'Autocorrect', 'Alberto sends an important message to his new boss. Autocorrect changes three words. What follows is a day of explanations, apologies and, finally, a promotion.']),
  story('daily', 5, ['wedding-speech', 'The wedding speech', 'Sara has to give the speech at her brother\'s wedding. She loses her notes, improvises, tells the wrong story, and somehow it is the best part of the day.']),
  story('daily', 6, ['surprise-party', 'The surprise party', 'A family plans a surprise party for grandmother\'s ninetieth birthday. Everything goes wrong, and grandmother, who knew all along, saves the evening.']),
  // Friends talking.
  pod('chat', 1, ['weekend', 'What are you doing this weekend?', 'Ana and Leo talk about their weekend plans: the market, a film, visiting family, and the weather.']),
  pod('chat', 1, ['favourite-food', 'Favourite food', 'Ana and Leo talk about what they like to eat and drink, and what they do not like at all.']),
  pod('chat', 2, ['family', 'My family', 'Ana and Leo talk about their families: brothers, sisters, parents and a very old cat.']),
  pod('chat', 2, ['pets', 'Cats or dogs?', 'Ana has a cat, Leo has a dog. They argue, kindly, about which pet is better.']),
  pod('chat', 3, ['holidays', 'The last holiday', 'Ana tells Leo about her last holiday: the trip, the hotel, the food and one thing that went wrong.']),
  pod('chat', 3, ['hobbies', 'New hobbies', 'Leo started learning guitar and Ana started running. They talk about how hard it is to start something new.']),
  pod('chat', 3, ['school-days', 'When we were at school', 'Ana and Leo remember school: favourite teachers, subjects they hated, and a funny story.']),
  pod('chat', 4, ['moving-city', 'Moving to a new city', 'Leo is thinking about moving to a big city for work. Ana gives advice about costs, friends and what he would miss.']),
  pod('chat', 4, ['screen-time', 'Too much phone?', 'Ana and Leo talk about how much they use their phones, and whether to try a week without social media.']),
  pod('chat', 6, ['dream-job', 'The dream job', 'Ana and Leo discuss what makes a good job: money, free time, meaning. They disagree and give reasons.']),
  pod('chat', 2, ['morning-person', 'Morning or night person?', 'Ana gets up at six and loves it. Leo is never awake before ten. They compare their days and try to find a time to meet.']),
  pod('chat', 2, ['best-gift', 'The best present', 'Ana and Leo talk about the best and worst presents they have ever had, and what to buy a friend.']),
  pod('chat', 3, ['cooking-disaster', 'A cooking disaster', 'Leo tried to cook paella for friends. Ana asks what happened, step by step, and gives him tips for next time.']),
  pod('chat', 4, ['volunteering', 'Helping out', 'Ana volunteers at a food bank. Leo asks why, how it works, and whether it changes how she sees her city.']),
  pod('chat', 5, ['sleep', 'Why we sleep', 'Ana has read about sleep science. She and Leo discuss dreams, naps, phones in bed and how much sleep people really need.']),
  pod('chat', 5, ['books', 'A book that changed me', 'Ana and Leo each describe a book that changed how they think, and argue about whether the film was better.']),
  pod('chat', 6, ['nostalgia', 'Was it better before?', 'Ana and Leo debate whether life was better in the past: memory, nostalgia, progress and what we lose and gain.']),
  // Places and culture.
  pod('travel', 2, ['at-the-market', 'At the market', 'Ana shows Leo around a food market: fruit, cheese, bread, prices and how to ask for things.']),
  pod('travel', 3, ['festivals', 'Festivals', 'Ana and Leo talk about famous festivals: a tomato fight, a festival of lights, and a local party in their town.']),
  pod('travel', 3, ['train-trip', 'A trip by train', 'Leo plans a train trip and Ana helps: tickets, times, changing trains, and what to bring.']),
  pod('travel', 4, ['meal-times', 'Meal times around the world', 'Ana and Leo compare when people eat in different countries: late dinners, long lunches, and small snacks.']),
  pod('travel', 6, ['cities-change', 'How cities change', 'Ana and Leo talk about how their city has changed: new shops, tourists, prices, and what has been lost.']),
  pod('travel', 1, ['beach-mountains', 'Beach or mountains?', 'Ana loves the beach, Leo loves the mountains. They plan a holiday and must choose one.']),
  pod('travel', 3, ['street-food', 'Street food', 'Ana and Leo talk about street food they have tried on their travels: tacos, churros, and something very strange.']),
  pod('travel', 4, ['museum-day', 'A day at the museum', 'Ana went to a big art museum. She describes the paintings she liked, the crowds, and the one she did not understand.']),
  pod('travel', 5, ['night-train', 'The night train', 'Leo took a night train across the country. He describes the people he met, the sleepless night and the sunrise.']),
  pod('travel', 6, ['island-life', 'Island life', 'Ana spent a year on a small island. She and Leo discuss isolation, community, tourism and whether she would go back.']),
  // Made-up news (clearly made up, for fun).
  pod('news-fake', 1, ['cat-mayor', 'Cat becomes mayor', 'Made-up news: a small town chooses a cat as mayor. The cat sleeps in meetings. People are happy. The cat\'s first law: more fish.']),
  pod('news-fake', 2, ['giant-carrot', 'The giant carrot', 'Made-up news: a farmer grows a carrot as big as a car. The whole village helps to pull it out. They make soup for everyone.']),
  pod('news-fake', 3, ['robot-waiter', 'Robot waiter is too polite', 'Made-up news: a cafe buys a robot waiter. It says "thank you" so many times that nobody gets their food. The owner gives it a new job: saying hello.']),
  pod('news-fake', 3, ['penguin-bus', 'Penguin takes the bus', 'Made-up news: a penguin from the zoo gets on a city bus every morning and gets off at the fish market. The driver gives it a free ticket.']),
  pod('news-fake', 4, ['silent-city', 'The city of silence', 'Made-up news: a city bans car horns, loud music and shouting for one day. People hear birds for the first time. Some love it, some find it strange.']),
  pod('news-fake', 5, ['four-day-week', 'Everyone gets Friday off', 'Made-up news: a country tries a four-day working week. Reporters talk to a happy worker, a worried shop owner and an expert.']),
  pod('news-fake', 1, ['chocolate-river', 'A river of chocolate', 'Made-up news: a chocolate factory has a small accident and the street becomes a river of chocolate. Children come with spoons.']),
  pod('news-fake', 2, ['snowman-traffic', 'Snowman stops traffic', 'Made-up news: a giant snowman appears in the middle of a road. Nobody knows who built it. Drivers stop to take photos.']),
  pod('news-fake', 3, ['parrot-languages', 'Parrot speaks five languages', 'Made-up news: a parrot in a hotel greets guests in five languages, but only says rude words in a sixth.']),
  pod('news-fake', 4, ['library-dog', 'Dog runs the library', 'Made-up news: a library dog becomes so popular that children read to it every afternoon, and reading scores go up.']),
  pod('news-fake', 5, ['moon-hotel', 'First hotel on the Moon', 'Made-up news: a hotel on the Moon opens. Reporters interview a guest about the view, the food and the very high price.']),
  pod('news-fake', 6, ['extra-hour', 'Government adds an hour to the day', 'Made-up news: a country decides the day will have twenty-five hours. Experts, workers and children react, with irony.']),
  // News from history.
  pod('news-history', 3, ['moon-landing', '1969: people walk on the Moon', 'A news report from July 1969: Apollo 11 lands on the Moon. Neil Armstrong and Buzz Aldrin walk on it. Millions watch on television.']),
  pod('news-history', 3, ['first-flight', '1903: the first aeroplane flight', 'A news report from December 1903: the Wright brothers fly a plane for 12 seconds at Kitty Hawk.']),
  pod('news-history', 3, ['penicillin', '1928: a mould that kills germs', 'A news report: Alexander Fleming comes back from holiday and finds mould killing bacteria in his lab. This becomes penicillin.']),
  pod('news-history', 4, ['berlin-wall', '1989: the Berlin Wall opens', 'A news report from November 1989: the border in Berlin opens. People cross, climb the wall and celebrate together.']),
  pod('news-history', 4, ['titanic', '1912: the Titanic sinks', 'A news report from April 1912: the new ship Titanic hits an iceberg on its first trip. Many people die; there are not enough lifeboats.']),
  pod('news-history', 4, ['printing-press', 'Around 1450: books for everyone', 'A news report as if from the 1450s: Gutenberg prints books with moving metal letters. Books become cheaper and more people learn to read.']),
  pod('news-history', 6, ['everest', '1953: the top of Everest', 'A news report from May 1953: Edmund Hillary and Tenzing Norgay reach the top of Mount Everest for the first time.']),
  pod('news-history', 6, ['world-wide-web', '1991: the World Wide Web', 'A news report from 1991: Tim Berners-Lee puts the first website online, at CERN, and offers the idea to everyone for free.']),
  pod('news-history', 2, ['eiffel-tower', '1889: the Eiffel Tower opens', 'A news report from Paris, 1889: a new iron tower opens for the World Fair. Some people love it and some say it is ugly.']),
  pod('news-history', 3, ['telephone', '1876: the first telephone call', 'A news report from 1876: Alexander Graham Bell speaks through a wire to his assistant: "Come here, I want to see you."']),
  pod('news-history', 3, ['olympics-1896', '1896: the first modern Olympic Games', 'A news report from Athens, 1896: athletes from fourteen countries meet for the first modern Olympics.']),
  pod('news-history', 4, ['tutankhamun', '1922: Tutankhamun\'s tomb', 'A news report from Egypt, 1922: Howard Carter opens the tomb of a young pharaoh, full of gold and treasures.']),
  pod('news-history', 4, ['tereshkova', '1963: the first woman in space', 'A news report from 1963: Valentina Tereshkova orbits the Earth forty-eight times in Vostok 6.']),
  pod('news-history', 5, ['dna', '1953: the shape of DNA', 'A news report from 1953: scientists describe the double helix of DNA, building on Rosalind Franklin\'s X-ray images.']),
  pod('news-history', 5, ['channel-tunnel', '1994: the Channel Tunnel opens', 'A news report from 1994: trains run under the sea between England and France for the first time.']),
  // Today's real headlines, written as a short bulletin when opened.
  pod('news-real', 1, [REAL_NEWS, 'Today\'s real news', 'A short, simple news bulletin about today\'s real headlines.']),
];

export const pieceById = (id: string) => LIBRARY.find((x) => x.id === id);

/** The library for one kind, in the order of its genres. */
export const libraryFor = (kind: Listening['kind']) =>
  GENRES.filter((g) => g.kind === kind).map((g) => ({ ...g, pieces: LIBRARY.filter((x) => x.genre === g.genre) }));

/**
 * The pre-made piece a story or podcast square lands on: pieces at that level first (then
 * easier ones), in turn, so each square has its own piece. Real news is never on the board,
 * since a square should be the same piece every time it is played.
 */
export function pieceForSpace(level: LevelId, spaceKey: string): Premade | undefined {
  const spaces = boardFor(level);
  const space = spaces.find((s) => s.key === spaceKey);
  if (!space) return undefined;
  const ordinal = spaces.filter((s) => s.kind === space.kind).findIndex((s) => s.key === spaceKey);
  const fits = LIBRARY.filter((x) => x.kind === space.kind && x.id !== REAL_NEWS);
  const pool = [...fits.filter((x) => x.level === level), ...fits.filter((x) => x.level < level).reverse()];
  return pool.length ? pool[ordinal % pool.length] : undefined;
}
