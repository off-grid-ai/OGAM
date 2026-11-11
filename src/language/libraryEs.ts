/**
 * Pre-made pieces written out in full in Spanish, so they open instantly with no model. The
 * rest of the library is written by the AI on the phone from its outline (library.ts).
 */
import type { Line, Listening, Part, Question, Word } from './listening';

const q = (question: string, options: string[], answer: number): Question => ({ q: question, options, answer });
const part = (lines: [string, string, string?][], question?: Question): Part =>
  ({ lines: lines.map(([t, en, speaker]): Line => (speaker ? { speaker, t, en } : { t, en })), ...(question ? { question } : {}) });
const words = (list: [string, string][]): Word[] => list.map(([t, en]) => ({ t, en }));
const piece = ([kind, title]: [Listening['kind'], string], parts: Part[], vocab: Word[]): Omit<Listening, 'createdAt'> => ({ kind, title, parts, vocab });

export const WRITTEN_ES: Record<string, Omit<Listening, 'createdAt'>> = {
  'three-pigs': piece(['story', 'Los tres cerditos'], [
    part([
      ['Hay tres cerditos.', 'There are three little pigs.'],
      ['El primer cerdito hace una casa de paja.', 'The first little pig makes a house of straw.'],
      ['El segundo hace una casa de palos.', 'The second makes a house of sticks.'],
      ['El tercero hace una casa de ladrillos. Es lento, pero la casa es fuerte.', 'The third makes a house of bricks. He is slow, but the house is strong.'],
    ], q('What is the third house made of?', ['Straw', 'Sticks', 'Bricks'], 2)),
    part([
      ['Un lobo llega a la casa de paja.', 'A wolf arrives at the straw house.'],
      ['"Soplo y soplo", dice el lobo. La casa cae.', '"I blow and I blow," says the wolf. The house falls.'],
      ['El cerdito corre a la casa de palos. El lobo sopla otra vez y la casa cae.', 'The little pig runs to the stick house. The wolf blows again and the house falls.'],
    ], q('What does the wolf do to the houses?', ['He blows them down', 'He buys them', 'He paints them'], 0)),
    part([
      ['Los dos cerditos corren a la casa de ladrillos.', 'The two little pigs run to the brick house.'],
      ['El lobo sopla y sopla, pero la casa no cae.', 'The wolf blows and blows, but the house does not fall.'],
      ['El lobo está cansado y se va. Los tres cerditos están contentos.', 'The wolf is tired and leaves. The three little pigs are happy.'],
    ], q('How do the pigs feel at the end?', ['Sad', 'Happy', 'Angry'], 1)),
  ], words([['cerdito', 'little pig'], ['casa', 'house'], ['paja', 'straw'], ['palo', 'stick'], ['ladrillo', 'brick'], ['lobo', 'wolf'], ['soplar', 'to blow'], ['fuerte', 'strong'], ['cansado', 'tired']])),

  'wrong-coffee': piece(['story', 'El café equivocado'], [
    part([
      ['Sam entra en un café.', 'Sam goes into a cafe.'],
      ['"Un café solo, pequeño, por favor", dice Sam.', '"A small black coffee, please," says Sam.'],
      ['El camarero dice: "Muy bien."', 'The waiter says: "Very good."'],
    ], q('What does Sam order?', ['A small black coffee', 'A big tea', 'A cake'], 0)),
    part([
      ['El camarero trae un chocolate caliente enorme, con nata.', 'The waiter brings a huge hot chocolate, with cream.'],
      ['Sam mira el chocolate. No dice nada. Es tímido.', 'Sam looks at the chocolate. He says nothing. He is shy.'],
      ['Sam bebe todo el chocolate, despacio.', 'Sam drinks all the chocolate, slowly.'],
    ], q('Why does Sam say nothing?', ['He is shy', 'He is angry', 'He is asleep'], 0)),
    part([
      ['Después, Sam llama al camarero.', 'Afterwards, Sam calls the waiter.'],
      ['"Y ahora... un café solo, pequeño, por favor."', '"And now... a small black coffee, please."'],
      ['El camarero sonríe y trae un té.', 'The waiter smiles and brings a tea.'],
    ], q('What does the waiter bring the second time?', ['A coffee', 'A tea', 'Water'], 1)),
  ], words([['camarero', 'waiter'], ['café solo', 'black coffee'], ['pequeño', 'small'], ['enorme', 'huge'], ['nata', 'cream'], ['tímido', 'shy'], ['despacio', 'slowly'], ['sonreír', 'to smile']])),

  'weekend': piece(['podcast', '¿Qué haces este fin de semana?'], [
    part([
      ['Hola, Leo. ¿Qué haces este fin de semana?', 'Hi, Leo. What are you doing this weekend?', 'Ana'],
      ['Hola, Ana. El sábado voy al mercado por la mañana.', 'Hi, Ana. On Saturday I am going to the market in the morning.', 'Leo'],
      ['¿Qué compras en el mercado?', 'What do you buy at the market?', 'Ana'],
      ['Fruta, pan y queso. Me gusta mucho el queso.', 'Fruit, bread and cheese. I like cheese a lot.', 'Leo'],
    ], q('When does Leo go to the market?', ['Saturday morning', 'Sunday night', 'Friday'], 0)),
    part([
      ['¿Y tú, Ana?', 'And you, Ana?', 'Leo'],
      ['El sábado por la tarde voy al cine con mi hermana.', 'On Saturday afternoon I am going to the cinema with my sister.', 'Ana'],
      ['¿Qué película?', 'Which film?', 'Leo'],
      ['Una comedia. Necesito reír.', 'A comedy. I need to laugh.', 'Ana'],
    ], q('Who does Ana go to the cinema with?', ['Her mother', 'Her sister', 'Leo'], 1)),
    part([
      ['¿Y el domingo?', 'And on Sunday?', 'Ana'],
      ['El domingo como con mis padres. ¿Hace buen tiempo?', 'On Sunday I have lunch with my parents. Is the weather good?', 'Leo'],
      ['Sí, hace sol. Perfecto para un paseo.', 'Yes, it is sunny. Perfect for a walk.', 'Ana'],
    ], q('What is the weather like on Sunday?', ['Rainy', 'Sunny', 'Cold'], 1)),
  ], words([['fin de semana', 'weekend'], ['mercado', 'market'], ['queso', 'cheese'], ['cine', 'cinema'], ['película', 'film'], ['reír', 'to laugh'], ['padres', 'parents'], ['hace sol', 'it is sunny'], ['paseo', 'walk']])),

  'cat-mayor': piece(['podcast', 'Un gato es alcalde'], [
    part([
      ['Buenos días. Hoy tenemos una noticia inventada y divertida.', 'Good morning. Today we have a made-up, funny news story.', 'Ana'],
      ['En un pueblo pequeño, la gente elige a un gato como alcalde.', 'In a small town, the people choose a cat as mayor.', 'Leo'],
      ['¿Un gato? ¿De verdad?', 'A cat? Really?', 'Ana'],
      ['Sí. Se llama Bigotes y es negro y blanco.', 'Yes. His name is Whiskers and he is black and white.', 'Leo'],
    ], q('Who is the new mayor?', ['A dog', 'A cat', 'A child'], 1)),
    part([
      ['¿Y qué hace el alcalde Bigotes?', 'And what does Mayor Whiskers do?', 'Ana'],
      ['Duerme en todas las reuniones.', 'He sleeps in every meeting.', 'Leo'],
      ['Pero la gente está contenta. El pueblo está tranquilo.', 'But the people are happy. The town is calm.', 'Ana'],
    ], q('What does the mayor do in meetings?', ['He sleeps', 'He sings', 'He eats'], 0)),
    part([
      ['¿Tiene una ley nueva?', 'Does he have a new law?', 'Ana'],
      ['Sí, su primera ley: más pescado para todos.', 'Yes, his first law: more fish for everyone.', 'Leo'],
      ['Me gusta este alcalde. Hasta mañana.', 'I like this mayor. See you tomorrow.', 'Ana'],
    ], q('What is the first law?', ['More fish', 'No cars', 'Longer holidays'], 0)),
  ], words([['noticia', 'news story'], ['inventada', 'made up'], ['pueblo', 'town'], ['elegir', 'to choose'], ['alcalde', 'mayor'], ['bigotes', 'whiskers'], ['reunión', 'meeting'], ['ley', 'law'], ['pescado', 'fish (to eat)']])),
  'tortoise-hare': piece(['story', 'La tortuga y la liebre'], [
    part([
      ['La liebre es muy rápida.', 'The hare is very fast.'],
      ['La tortuga es muy lenta.', 'The tortoise is very slow.'],
      ['La liebre se ríe de la tortuga.', 'The hare laughs at the tortoise.'],
      ['"¿Una carrera?", pregunta la tortuga.', '"A race?" asks the tortoise.'],
    ], q('Who is fast?', ['The tortoise', 'The hare', 'Both'], 1)),
    part([
      ['La carrera empieza. La liebre corre mucho.', 'The race starts. The hare runs a lot.'],
      ['La liebre está cansada. Duerme debajo de un árbol.', 'The hare is tired. It sleeps under a tree.'],
      ['La tortuga camina y camina. No para.', 'The tortoise walks and walks. It does not stop.'],
    ], q('What does the hare do under the tree?', ['It eats', 'It sleeps', 'It reads'], 1)),
    part([
      ['La liebre se despierta. Corre, pero es tarde.', 'The hare wakes up. It runs, but it is late.'],
      ['La tortuga gana la carrera.', 'The tortoise wins the race.'],
      ['Despacio, pero siempre adelante.', 'Slowly, but always forward.'],
    ], q('Who wins?', ['The tortoise', 'The hare', 'Nobody'], 0)),
  ], words([['tortuga', 'tortoise'], ['liebre', 'hare'], ['rápido', 'fast'], ['lento', 'slow'], ['carrera', 'race'], ['árbol', 'tree'], ['despertarse', 'to wake up'], ['ganar', 'to win']])),

  'lost-keys': piece(['story', '¿Dónde están mis llaves?'], [
    part([
      ['Son las ocho. Ana llega tarde al trabajo.', 'It is eight o\'clock. Ana is late for work.'],
      ['"¿Dónde están mis llaves?", dice Ana.', '"Where are my keys?" says Ana.'],
      ['Busca en la cocina. No están.', 'She looks in the kitchen. They are not there.'],
    ], q('Why is Ana in a hurry?', ['She is late for work', 'She is hungry', 'She is ill'], 0)),
    part([
      ['Busca en el dormitorio y en el baño.', 'She looks in the bedroom and in the bathroom.'],
      ['Busca en el coche. Nada.', 'She looks in the car. Nothing.'],
      ['Ana está muy nerviosa.', 'Ana is very nervous.'],
    ], q('Where does Ana NOT look?', ['In the kitchen', 'In the garden', 'In the car'], 1)),
    part([
      ['Su hija la mira y se ríe.', 'Her daughter looks at her and laughs.'],
      ['"Mamá, las llaves están en tu mano."', '"Mum, the keys are in your hand."'],
      ['Ana se ríe también.', 'Ana laughs too.'],
    ], q('Where are the keys?', ['In the bag', 'In her hand', 'In the door'], 1)),
  ], words([['llaves', 'keys'], ['llegar tarde', 'to be late'], ['buscar', 'to look for'], ['cocina', 'kitchen'], ['dormitorio', 'bedroom'], ['baño', 'bathroom'], ['nervioso', 'nervous'], ['hija', 'daughter'], ['mano', 'hand']])),

  'lion-mouse': piece(['story', 'El león y el ratón'], [
    part([
      ['Un león duerme en el bosque.', 'A lion is sleeping in the forest.'],
      ['Un ratón pequeño camina sobre el león.', 'A small mouse walks over the lion.'],
      ['El león se despierta y atrapa al ratón.', 'The lion wakes up and catches the mouse.'],
    ], q('What is the lion doing at the start?', ['Eating', 'Sleeping', 'Running'], 1)),
    part([
      ['"Por favor, déjame ir. Un día te ayudo", dice el ratón.', '"Please let me go. One day I will help you," says the mouse.'],
      ['El león se ríe: "¿Tú? ¿Ayudarme a mí?"', 'The lion laughs: "You? Help me?"'],
      ['Pero deja ir al ratón.', 'But he lets the mouse go.'],
    ], q('Does the lion let the mouse go?', ['Yes', 'No', 'We do not know'], 0)),
    part([
      ['Unos días después, el león está atrapado en una red.', 'A few days later, the lion is caught in a net.'],
      ['El ratón llega y muerde la red.', 'The mouse arrives and bites the net.'],
      ['El león está libre. Ahora son amigos.', 'The lion is free. Now they are friends.'],
    ], q('How does the mouse help?', ['It calls other lions', 'It bites the net', 'It brings food'], 1)),
  ], words([['león', 'lion'], ['ratón', 'mouse'], ['bosque', 'forest'], ['atrapar', 'to catch'], ['ayudar', 'to help'], ['red', 'net'], ['morder', 'to bite'], ['libre', 'free']])),

  'dog-sandwich': piece(['story', 'El perro y el bocadillo'], [
    part([
      ['Leo tiene mucha hambre.', 'Leo is very hungry.'],
      ['Hace un bocadillo grande de jamón y queso.', 'He makes a big ham and cheese sandwich.'],
      ['Pone el bocadillo en la mesa.', 'He puts the sandwich on the table.'],
    ], q('What is in the sandwich?', ['Ham and cheese', 'Chicken', 'Tomato'], 0)),
    part([
      ['Suena el teléfono. Es su madre.', 'The phone rings. It is his mother.'],
      ['Leo habla diez minutos.', 'Leo talks for ten minutes.'],
      ['Su perro, Toby, mira la mesa.', 'His dog, Toby, looks at the table.'],
    ], q('Who calls Leo?', ['His friend', 'His mother', 'His boss'], 1)),
    part([
      ['Leo vuelve a la cocina. El plato está vacío.', 'Leo comes back to the kitchen. The plate is empty.'],
      ['Toby lo mira con ojos inocentes.', 'Toby looks at him with innocent eyes.'],
      ['Pero tiene pan en la nariz.', 'But he has bread on his nose.'],
    ], q('How do we know the dog ate it?', ['He is sleeping', 'He has bread on his nose', 'He is barking'], 1)),
  ], words([['bocadillo', 'sandwich'], ['jamón', 'ham'], ['mesa', 'table'], ['sonar', 'to ring'], ['perro', 'dog'], ['vacío', 'empty'], ['plato', 'plate'], ['nariz', 'nose']])),

  'giant-carrot': piece(['podcast', 'La zanahoria gigante'], [
    part([
      ['Hola a todos. Hoy tenemos otra noticia inventada.', 'Hello everyone. Today we have another made-up news story.', 'Ana'],
      ['Un granjero tiene una zanahoria muy grande en su huerto.', 'A farmer has a very big carrot in his vegetable garden.', 'Leo'],
      ['¿Cómo de grande?', 'How big?', 'Ana'],
      ['Tan grande como un coche.', 'As big as a car.', 'Leo'],
    ], q('How big is the carrot?', ['As big as a car', 'As big as a dog', 'As big as a house'], 0)),
    part([
      ['El granjero no puede sacarla de la tierra.', 'The farmer cannot pull it out of the ground.', 'Leo'],
      ['Su mujer ayuda. Su hijo ayuda. El perro ayuda.', 'His wife helps. His son helps. The dog helps.', 'Leo'],
      ['¿Y salió la zanahoria?', 'And did the carrot come out?', 'Ana'],
      ['No. Al final, todo el pueblo ayuda, y sale.', 'No. In the end, the whole village helps, and it comes out.', 'Leo'],
    ], q('Who finally helps?', ['Only the dog', 'The whole village', 'Nobody'], 1)),
    part([
      ['¿Y qué hacen con una zanahoria tan grande?', 'And what do they do with such a big carrot?', 'Ana'],
      ['Sopa. Sopa de zanahoria para todo el pueblo, durante una semana.', 'Soup. Carrot soup for the whole village, for a week.', 'Leo'],
      ['Qué rico. Hasta mañana.', 'How tasty. See you tomorrow.', 'Ana'],
    ], q('What do they make?', ['Cake', 'Soup', 'Juice'], 1)),
  ], words([['zanahoria', 'carrot'], ['granjero', 'farmer'], ['huerto', 'vegetable garden'], ['tierra', 'ground'], ['sacar', 'to pull out'], ['pueblo', 'village'], ['sopa', 'soup'], ['semana', 'week']])),

  'family': piece(['podcast', 'Mi familia'], [
    part([
      ['Leo, ¿tienes hermanos?', 'Leo, do you have brothers or sisters?', 'Ana'],
      ['Sí, tengo una hermana mayor. Se llama Marta.', 'Yes, I have an older sister. Her name is Marta.', 'Leo'],
      ['¿Dónde vive?', 'Where does she live?', 'Ana'],
      ['Vive en Valencia con su marido y dos hijos.', 'She lives in Valencia with her husband and two children.', 'Leo'],
    ], q('How many children does Marta have?', ['One', 'Two', 'Three'], 1)),
    part([
      ['¿Y tú, Ana?', 'And you, Ana?', 'Leo'],
      ['Yo soy hija única, pero tengo muchos primos.', 'I am an only child, but I have lots of cousins.', 'Ana'],
      ['¿Y tus padres?', 'And your parents?', 'Leo'],
      ['Viven en el campo, con un gato muy viejo.', 'They live in the countryside, with a very old cat.', 'Ana'],
    ], q('Does Ana have brothers or sisters?', ['Yes, two', 'No, she is an only child', 'Yes, one sister'], 1)),
    part([
      ['¿Cuántos años tiene el gato?', 'How old is the cat?', 'Leo'],
      ['Veinte años. Es el jefe de la familia.', 'Twenty years old. He is the head of the family.', 'Ana'],
      ['Ja, ja. Quiero conocerlo.', 'Ha ha. I want to meet him.', 'Leo'],
    ], q('How old is the cat?', ['Two', 'Ten', 'Twenty'], 2)),
  ], words([['hermana mayor', 'older sister'], ['marido', 'husband'], ['hijos', 'children'], ['hija única', 'only child (girl)'], ['primos', 'cousins'], ['campo', 'countryside'], ['viejo', 'old'], ['jefe', 'boss, head'], ['conocer', 'to meet']])),

  'at-the-market': piece(['podcast', 'En el mercado'], [
    part([
      ['Leo, hoy vamos al mercado. ¿Qué necesitas?', 'Leo, today we are going to the market. What do you need?', 'Ana'],
      ['Necesito fruta y pan.', 'I need fruit and bread.', 'Leo'],
      ['Mira, aquí venden naranjas muy buenas.', 'Look, here they sell very good oranges.', 'Ana'],
    ], q('What does Leo need?', ['Fish and rice', 'Fruit and bread', 'Milk and eggs'], 1)),
    part([
      ['Buenos días. ¿A cuánto están las naranjas?', 'Good morning. How much are the oranges?', 'Leo'],
      ['A dos euros el kilo.', 'Two euros a kilo.', 'Ana'],
      ['Póngame un kilo, por favor.', 'A kilo, please.', 'Leo'],
      ['Muy bien. ¿Algo más?', 'Very good. Anything else?', 'Ana'],
    ], q('How much is a kilo of oranges?', ['One euro', 'Two euros', 'Five euros'], 1)),
    part([
      ['Sí, una barra de pan y un poco de queso.', 'Yes, a loaf of bread and a bit of cheese.', 'Leo'],
      ['Son cinco euros en total.', 'That is five euros in total.', 'Ana'],
      ['Aquí tiene. Gracias, hasta luego.', 'Here you are. Thanks, see you later.', 'Leo'],
    ], q('How much does Leo pay in total?', ['Two euros', 'Five euros', 'Ten euros'], 1)),
  ], words([['mercado', 'market'], ['necesitar', 'to need'], ['vender', 'to sell'], ['naranja', 'orange'], ['¿a cuánto está?', 'how much is it?'], ['kilo', 'kilo'], ['barra de pan', 'loaf of bread'], ['en total', 'in total']])),

  'holidays': piece(['podcast', 'Las últimas vacaciones'], [
    part([
      ['Ana, ¿qué tal tus vacaciones?', 'Ana, how were your holidays?', 'Leo'],
      ['Muy bien. Fui a Portugal una semana con dos amigas.', 'Very good. I went to Portugal for a week with two friends.', 'Ana'],
      ['¿Cómo fuisteis?', 'How did you get there?', 'Leo'],
      ['En tren y luego en autobús. Fue largo, pero bonito.', 'By train and then by bus. It was long, but beautiful.', 'Ana'],
    ], q('How long was Ana in Portugal?', ['A weekend', 'A week', 'A month'], 1)),
    part([
      ['¿Dónde os quedasteis?', 'Where did you stay?', 'Leo'],
      ['En un hotel pequeño cerca de la playa.', 'In a small hotel near the beach.', 'Ana'],
      ['¿Y la comida?', 'And the food?', 'Leo'],
      ['Comimos pescado todos los días. Estaba buenísimo.', 'We ate fish every day. It was delicious.', 'Ana'],
    ], q('What did they eat every day?', ['Pizza', 'Fish', 'Salad'], 1)),
    part([
      ['¿Algo salió mal?', 'Did anything go wrong?', 'Leo'],
      ['Sí. El último día perdí la maleta en la estación.', 'Yes. On the last day I lost my suitcase at the station.', 'Ana'],
      ['Vaya. ¿La encontraste?', 'Oh no. Did you find it?', 'Leo'],
      ['Sí, dos horas después. Un señor muy amable la tenía.', 'Yes, two hours later. A very kind man had it.', 'Ana'],
    ], q('What went wrong?', ['She missed the train', 'She lost her suitcase', 'She got ill'], 1)),
  ], words([['vacaciones', 'holidays'], ['fui', 'I went'], ['largo', 'long'], ['quedarse', 'to stay'], ['playa', 'beach'], ['pescado', 'fish (to eat)'], ['salir mal', 'to go wrong'], ['maleta', 'suitcase'], ['amable', 'kind']])),

  'robot-waiter': piece(['podcast', 'El robot camarero es demasiado educado'], [
    part([
      ['Buenas tardes. Hoy, una noticia inventada desde una cafetería.', 'Good afternoon. Today, a made-up story from a cafe.', 'Ana'],
      ['La dueña compró un robot para servir a los clientes.', 'The owner bought a robot to serve the customers.', 'Leo'],
      ['¿Y funciona bien?', 'And does it work well?', 'Ana'],
      ['Demasiado bien. Es muy, muy educado.', 'Too well. It is very, very polite.', 'Leo'],
    ], q('Who bought the robot?', ['A customer', 'The owner', 'A school'], 1)),
    part([
      ['Cada vez que alguien pide un café, el robot dice "gracias".', 'Every time someone orders a coffee, the robot says "thank you".', 'Leo'],
      ['Y luego otra vez, y otra vez, y otra vez.', 'And then again, and again, and again.', 'Leo'],
      ['Entonces, ¿los clientes no reciben su café?', 'So the customers do not get their coffee?', 'Ana'],
      ['Exacto. Esperan media hora.', 'Exactly. They wait half an hour.', 'Leo'],
    ], q('What is the problem?', ['It is rude', 'It says thank you too much', 'It breaks the cups'], 1)),
    part([
      ['¿Y qué hizo la dueña?', 'And what did the owner do?', 'Ana'],
      ['Le dio un trabajo nuevo: saludar a la gente en la puerta.', 'She gave it a new job: greeting people at the door.', 'Leo'],
      ['Perfecto. Ahora todos entran contentos.', 'Perfect. Now everyone comes in happy.', 'Ana'],
    ], q('What is the robot\'s new job?', ['Cooking', 'Greeting people at the door', 'Cleaning'], 1)),
  ], words([['camarero', 'waiter'], ['educado', 'polite'], ['dueña', 'owner'], ['cliente', 'customer'], ['demasiado', 'too (much)'], ['pedir', 'to order'], ['esperar', 'to wait'], ['saludar', 'to greet']])),
};

/** A written-out piece for a language, if there is one (Spanish only for now). */
export const writtenPiece = (id: string, code: string): Omit<Listening, 'createdAt'> | undefined =>
  (code.startsWith('es') ? WRITTEN_ES[id] : undefined);
