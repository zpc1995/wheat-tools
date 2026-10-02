/**
 * Password strength analysis — pure logic.
 *
 * No React, no DOM, no clock, no storage, no network: this module cannot send
 * anything anywhere even by accident, which is the point. Everything it needs is
 * its arguments.
 *
 * ## Why charset entropy alone is not enough
 *
 * `length × log2(poolSize)` is the entropy of a password drawn *uniformly at
 * random* from that pool. People do not draw uniformly. "password123" has 11
 * characters over a 36-character pool, so that formula pays it 56.9 bits — yet
 * it is on the first page of every cracking dictionary, and its real cost is a
 * handful of guesses. The classic illustration is XKCD #936: "Tr0ub4dor&3"
 * prices at 72.3 bits by charset arithmetic, while the comic prices it at about
 * 28 bits because it is one dictionary word plus two leet substitutions plus two
 * common suffixes.
 *
 * So two numbers are reported, and the difference between them is the message:
 *
 *   charsetBits    the upper bound, valid only for a uniformly random password
 *   effectiveBits  the cheapest cover of the password by known patterns; never
 *                  above charsetBits, and what the verdict and crack times use
 *
 * ## How the cover is found
 *
 * A small zxcvbn-style search. Candidates are collected — hits in the built-in
 * weak-password list, common words, keyboard runs, character sequences, repeats,
 * dates, and caller-supplied context words such as the site name — and a
 * dynamic program picks the cheapest way to cover every character, charging
 * `log2(poolSize)` for characters no pattern explains. Taking the *cheapest*
 * cover is what makes this an estimate of what an attacker does rather than a
 * description of what the password looks like.
 *
 * ## Known limits, stated rather than hidden
 *
 * - Every unexplained character is charged at the full pool size, even when its
 *   class is obviously a single digit. This errs low, which is the safe way to
 *   be wrong for a strength meter.
 * - The common-word list is a few hundred basic English words, not the tens of
 *   thousands a real cracking rig uses. A word outside it falls back to
 *   brute-force pricing, so this one errs high; it is the main weakness of the
 *   estimate.
 * - Each leet substitution is charged log2(3) bits regardless of which letter
 *   was replaced and how likely that replacement is.
 * - Every guess is assumed to require exactly one hash, and the attacker is
 *   assumed to search in the order this model would. Crack times are therefore
 *   order-of-magnitude figures, not predictions.
 */

export const MAX_ANALYSIS_LENGTH = 256;

/**
 * The 1000 most common passwords, in the exact order of the published source:
 * SecLists `Passwords/Common-Credentials/10k-most-common.txt`, itself an
 * aggregate of public breach corpora. Cross-checked against SecLists
 * `500-worst-passwords.txt`: 199 of the first 200 entries appear in both.
 *
 * Index + 1 is the published rank, and the rank is the entropy that a match is
 * charged — rank 1 is guessed first, so it costs log2(1) = 0 bits. The list is
 * kept in source order and complete up to a round number so that this
 * index-as-rank property stays true; dropping an entry would silently re-rank
 * everything after it. That is also why a few profane entries are left in: it
 * is factual breach data, and editing it for tone would corrupt the numbers.
 */
export const WEAK_PASSWORDS: readonly string[] = [
  'password', '123456', '12345678', '1234', 'qwerty', '12345', 'dragon', 'pussy', 'baseball', 'football', 'letmein', 'monkey', '696969', 'abc123', 'mustang', 'michael',
  'shadow', 'master', 'jennifer', '111111', '2000', 'jordan', 'superman', 'harley', '1234567', 'fuckme', 'hunter', 'fuckyou', 'trustno1', 'ranger', 'buster', 'thomas',
  'tigger', 'robert', 'soccer', 'fuck', 'batman', 'test', 'pass', 'killer', 'hockey', 'george', 'charlie', 'andrew', 'michelle', 'love', 'sunshine', 'jessica',
  'asshole', '6969', 'pepper', 'daniel', 'access', '123456789', '654321', 'joshua', 'maggie', 'starwars', 'silver', 'william', 'dallas', 'yankees', '123123', 'ashley',
  '666666', 'hello', 'amanda', 'orange', 'biteme', 'freedom', 'computer', 'sexy', 'thunder', 'nicole', 'ginger', 'heather', 'hammer', 'summer', 'corvette', 'taylor',
  'fucker', 'austin', '1111', 'merlin', 'matthew', '121212', 'golfer', 'cheese', 'princess', 'martin', 'chelsea', 'patrick', 'richard', 'diamond', 'yellow', 'bigdog',
  'secret', 'asdfgh', 'sparky', 'cowboy', 'camaro', 'anthony', 'matrix', 'falcon', 'iloveyou', 'bailey', 'guitar', 'jackson', 'purple', 'scooter', 'phoenix', 'aaaaaa',
  'morgan', 'tigers', 'porsche', 'mickey', 'maverick', 'cookie', 'nascar', 'peanut', 'justin', '131313', 'money', 'horny', 'samantha', 'panties', 'steelers', 'joseph',
  'snoopy', 'boomer', 'whatever', 'iceman', 'smokey', 'gateway', 'dakota', 'cowboys', 'eagles', 'chicken', 'dick', 'black', 'zxcvbn', 'please', 'andrea', 'ferrari',
  'knight', 'hardcore', 'melissa', 'compaq', 'coffee', 'booboo', 'bitch', 'johnny', 'bulldog', 'xxxxxx', 'welcome', 'james', 'player', 'ncc1701', 'wizard', 'scooby',
  'charles', 'junior', 'internet', 'bigdick', 'mike', 'brandy', 'tennis', 'blowjob', 'banana', 'monster', 'spider', 'lakers', 'miller', 'rabbit', 'enter', 'mercedes',
  'brandon', 'steven', 'fender', 'john', 'yamaha', 'diablo', 'chris', 'boston', 'tiger', 'marine', 'chicago', 'rangers', 'gandalf', 'winter', 'bigtits', 'barney',
  'edward', 'raiders', 'porn', 'badboy', 'blowme', 'spanky', 'bigdaddy', 'johnson', 'chester', 'london', 'midnight', 'blue', 'fishing', '000000', 'hannah', 'slayer',
  '11111111', 'rachel', 'sexsex', 'redsox', 'thx1138', 'asdf', 'marlboro', 'panther', 'zxcvbnm', 'arsenal', 'oliver', 'qazwsx', 'mother', 'victoria', '7777777', 'jasper',
  'angel', 'david', 'winner', 'crystal', 'golden', 'butthead', 'viking', 'jack', 'iwantu', 'shannon', 'murphy', 'angels', 'prince', 'cameron', 'girls', 'madison',
  'wilson', 'carlos', 'hooters', 'willie', 'startrek', 'captain', 'maddog', 'jasmine', 'butter', 'booger', 'angela', 'golf', 'lauren', 'rocket', 'tiffany', 'theman',
  'dennis', 'liverpoo', 'flower', 'forever', 'green', 'jackie', 'muffin', 'turtle', 'sophie', 'danielle', 'redskins', 'toyota', 'jason', 'sierra', 'winston', 'debbie',
  'giants', 'packers', 'newyork', 'jeremy', 'casper', 'bubba', '112233', 'sandra', 'lovers', 'mountain', 'united', 'cooper', 'driver', 'tucker', 'helpme', 'fucking',
  'pookie', 'lucky', 'maxwell', '8675309', 'bear', 'suckit', 'gators', '5150', '222222', 'shithead', 'fuckoff', 'jaguar', 'monica', 'fred', 'happy', 'hotdog',
  'tits', 'gemini', 'lover', 'xxxxxxxx', '777777', 'canada', 'nathan', 'victor', 'florida', '88888888', 'nicholas', 'rosebud', 'metallic', 'doctor', 'trouble', 'success',
  'stupid', 'tomcat', 'warrior', 'peaches', 'apples', 'fish', 'qwertyui', 'magic', 'buddy', 'dolphins', 'rainbow', 'gunner', '987654', 'freddy', 'alexis', 'braves',
  'cock', '2112', '1212', 'cocacola', 'xavier', 'dolphin', 'testing', 'bond007', 'member', 'calvin', 'voodoo', '7777', 'samson', 'alex', 'apollo', 'fire',
  'tester', 'walter', 'beavis', 'voyager', 'peter', 'porno', 'bonnie', 'rush2112', 'beer', 'apple', 'scorpio', 'jonathan', 'skippy', 'sydney', 'scott', 'red123',
  'power', 'gordon', 'travis', 'beaver', 'star', 'jackass', 'flyers', 'boobs', '232323', 'zzzzzz', 'steve', 'rebecca', 'scorpion', 'doggie', 'legend', 'ou812',
  'yankee', 'blazer', 'bill', 'runner', 'birdie', 'bitches', '555555', 'parker', 'topgun', 'asdfasdf', 'heaven', 'viper', 'animal', '2222', 'bigboy', '4444',
  'arthur', 'baby', 'private', 'godzilla', 'donald', 'williams', 'lifehack', 'phantom', 'dave', 'rock', 'august', 'sammy', 'cool', 'brian', 'platinum', 'jake',
  'bronco', 'paul', 'mark', 'frank', 'heka6w2', 'copper', 'billy', 'cumshot', 'garfield', 'willow', 'cunt', 'little', 'carter', 'slut', 'albert', '69696969',
  'kitten', 'super', 'jordan23', 'eagle1', 'shelby', 'america', '11111', 'jessie', 'house', 'free', '123321', 'chevy', 'bullshit', 'white', 'broncos', 'horney',
  'surfer', 'nissan', '999999', 'saturn', 'airborne', 'elephant', 'marvin', 'shit', 'action', 'adidas', 'qwert', 'kevin', '1313', 'explorer', 'walker', 'police',
  'christin', 'december', 'benjamin', 'wolf', 'sweet', 'therock', 'king', 'online', 'dickhead', 'brooklyn', 'teresa', 'cricket', 'sharon', 'dexter', 'racing', 'penis',
  'gregory', '0000', 'teens', 'redwings', 'dreams', 'michigan', 'hentai', 'magnum', '87654321', 'nothing', 'donkey', 'trinity', 'digital', '333333', 'stella', 'cartman',
  'guinness', '123abc', 'speedy', 'buffalo', 'kitty', 'pimpin', 'eagle', 'einstein', 'kelly', 'nelson', 'nirvana', 'vampire', 'xxxx', 'playboy', 'louise', 'pumpkin',
  'snowball', 'test123', 'girl', 'sucker', 'mexico', 'beatles', 'fantasy', 'ford', 'gibson', 'celtic', 'marcus', 'cherry', 'cassie', '888888', 'natasha', 'sniper',
  'chance', 'genesis', 'hotrod', 'reddog', 'alexande', 'college', 'jester', 'passw0rd', 'bigcock', 'smith', 'lasvegas', 'carmen', 'slipknot', '3333', 'death', 'kimberly',
  '1q2w3e', 'eclipse', '1q2w3e4r', 'stanley', 'samuel', 'drummer', 'homer', 'montana', 'music', 'aaaa', 'spencer', 'jimmy', 'carolina', 'colorado', 'creative', 'hello1',
  'rocky', 'goober', 'friday', 'bollocks', 'scotty', 'abcdef', 'bubbles', 'hawaii', 'fluffy', 'mine', 'stephen', 'horses', 'thumper', '5555', 'pussies', 'darkness',
  'asdfghjk', 'pamela', 'boobies', 'buddha', 'vanessa', 'sandman', 'naughty', 'douglas', 'honda', 'matt', 'azerty', '6666', 'shorty', 'money1', 'beach', 'loveme',
  '4321', 'simple', 'poohbear', '444444', 'badass', 'destiny', 'sarah', 'denise', 'vikings', 'lizard', 'melanie', 'assman', 'sabrina', 'nintendo', 'water', 'good',
  'howard', 'time', '123qwe', 'november', 'xxxxx', 'october', 'leather', 'bastard', 'young', '101010', 'extreme', 'hard', 'password1', 'vincent', 'pussy1', 'lacrosse',
  'hotmail', 'spooky', 'amateur', 'alaska', 'badger', 'paradise', 'maryjane', 'poop', 'crazy', 'mozart', 'video', 'russell', 'vagina', 'spitfire', 'anderson', 'norman',
  'eric', 'cherokee', 'cougar', 'barbara', 'long', '420420', 'family', 'horse', 'enigma', 'allison', 'raider', 'brazil', 'blonde', 'jones', '55555', 'dude',
  'drowssap', 'jeff', 'school', 'marshall', 'lovely', '1qaz2wsx', 'jeffrey', 'caroline', 'franklin', 'booty', 'molly', 'snickers', 'leslie', 'nipples', 'courtney', 'diesel',
  'rocks', 'eminem', 'westside', 'suzuki', 'daddy', 'passion', 'hummer', 'ladies', 'zachary', 'frankie', 'elvis', 'reggie', 'alpha', 'suckme', 'simpson', 'patricia',
  '147147', 'pirate', 'tommy', 'semperfi', 'jupiter', 'redrum', 'freeuser', 'wanker', 'stinky', 'ducati', 'paris', 'natalie', 'babygirl', 'bishop', 'windows', 'spirit',
  'pantera', 'monday', 'patches', 'brutus', 'houston', 'smooth', 'penguin', 'marley', 'forest', 'cream', '212121', 'flash', 'maximus', 'nipple', 'bobby', 'bradley',
  'vision', 'pokemon', 'champion', 'fireman', 'indian', 'softball', 'picard', 'system', 'clinton', 'cobra', 'enjoy', 'lucky1', 'claire', 'claudia', 'boogie', 'timothy',
  'marines', 'security', 'dirty', 'admin', 'wildcats', 'pimp', 'dancer', 'hardon', 'veronica', 'fucked', 'abcd1234', 'abcdefg', 'ironman', 'wolverin', 'remember', 'great',
  'freepass', 'bigred', 'squirt', 'justice', 'francis', 'hobbes', 'kermit', 'pearljam', 'mercury', 'domino', '9999', 'denver', 'brooke', 'rascal', 'hitman', 'mistress',
  'simon', 'tony', 'bbbbbb', 'friend', 'peekaboo', 'naked', 'budlight', 'electric', 'sluts', 'stargate', 'saints', 'bondage', 'brittany', 'bigman', 'zombie', 'swimming',
  'duke', 'qwerty1', 'babes', 'scotland', 'disney', 'rooster', 'brenda', 'mookie', 'swordfis', 'candy', 'duncan', 'olivia', 'hunting', 'blink182', 'alicia', '8888',
  'samsung', 'bubba1', 'whore', 'virginia', 'general', 'passport', 'aaaaaaaa', 'erotic', 'liberty', 'arizona', 'jesus', 'abcd', 'newport', 'skipper', 'rolltide', 'balls',
  'happy1', 'galore', 'christ', 'weasel', '242424', 'wombat', 'digger', 'classic', 'bulldogs', 'poopoo', 'accord', 'popcorn', 'turkey', 'jenny', 'amber', 'bunny',
  'mouse', '007007', 'titanic', 'liverpool', 'dreamer', 'everton', 'friends', 'chevelle', 'carrie', 'gabriel', 'psycho', 'nemesis', 'burton', 'pontiac', 'connor', 'eatme',
  'lickme', 'roland', 'cumming', 'mitchell', 'ireland', 'lincoln', 'arnold', 'spiderma', 'patriots', 'goblue', 'devils', 'eugene', 'empire', 'asdfg', 'cardinal', 'brown',
  'shaggy', 'froggy', 'qwer', 'kawasaki', 'kodiak', 'people', 'phpbb', 'light', '54321', 'kramer', 'chopper', 'hooker', 'honey', 'whynot', 'lesbian', 'lisa',
  'baxter', 'adam', 'snake', 'teen', 'ncc1701d', 'qqqqqq', 'airplane', 'britney', 'avalon', 'sandy', 'sugar', 'sublime', 'stewart', 'wildcat', 'raven', 'scarface',
  'elizabet', '123654', 'trucks', 'wolfpack', 'pervert', 'lawrence', 'raymond', 'redhead', 'american', 'alyssa', 'bambam', 'movie', 'woody', 'shaved', 'snowman', 'tiger1',
  'chicks', 'raptor', '1969', 'stingray', 'shooter', 'france', 'stars', 'madmax', 'kristen', 'sports', 'jerry', '789456', 'garcia', 'simpsons', 'lights', 'ryan',
  'looking', 'chronic', 'alison', 'hahaha', 'packard', 'hendrix', 'perfect', 'service', 'spring', 'srinivas', 'spike', 'katie', '252525', 'oscar', 'brother', 'bigmac',
  'suck', 'single', 'cannon', 'georgia', 'popeye', 'tattoo', 'texas', 'party', 'bullet', 'taurus', 'sailor', 'wolves', 'panthers', 'japan', 'strike', 'flowers',
  'pussycat', 'chris1', 'loverboy', 'berlin', 'sticky', 'marina', 'tarheels', 'fisher', 'russia', 'connie', 'wolfgang', 'testtest', 'mature', 'bass', 'catch22', 'juice',
  'michael1', 'nigger', '159753', 'women', 'alpha1', 'trooper', 'hawkeye', 'head', 'freaky', 'dodgers', 'pakistan', 'machine', 'pyramid', 'vegeta', 'katana', 'moose',
  'tinker', 'coyote', 'infinity', 'inside', 'pepsi', 'letmein1', 'bang', 'control',
];

const WEAK_RANKS = new Map<string, number>();
WEAK_PASSWORDS.forEach((entry, index) => {
  if (!WEAK_RANKS.has(entry)) WEAK_RANKS.set(entry, index + 1);
});

/** Published rank (1-based) of a password in the weak list, or undefined. */
export function weakPasswordRank(password: string): number | undefined {
  return WEAK_RANKS.get(password.toLowerCase());
}

/**
 * Common English words, used to price a letters-only fragment as a dictionary
 * word rather than as random letters. Basic vocabulary rather than a ranked
 * corpus: the number below is the assumption, and the list only decides *which*
 * fragments are treated as words.
 */
const COMMON_WORDS: readonly string[] = [
  'about', 'above', 'accept', 'access', 'account', 'across', 'action', 'active', 'actor',
  'actual', 'add', 'address', 'adult', 'advice', 'afraid', 'after', 'again', 'against',
  'age', 'agency', 'agent', 'agree', 'ahead', 'air', 'alarm', 'album', 'alert', 'alive',
  'allow', 'almost', 'alone', 'along', 'already', 'also', 'although', 'always', 'among',
  'amount', 'ancient', 'and', 'anger', 'angle', 'angry', 'animal', 'ankle', 'another',
  'answer', 'any', 'anyone', 'anything', 'apart', 'appeal', 'apple', 'apply', 'April',
  'area', 'argue', 'arise', 'arm', 'army', 'around', 'arrive', 'arrow', 'artist',
  'asleep', 'aspect', 'asset', 'assist', 'attack', 'attend', 'August', 'aunt', 'author',
  'autumn', 'available', 'average', 'avoid', 'awake', 'award', 'aware', 'away', 'awful',
  'baby', 'back', 'bacon', 'badge', 'bag', 'bake', 'balance', 'ball', 'banana', 'band',
  'bank', 'bar', 'bare', 'bargain', 'base', 'basic', 'basket', 'bath', 'battery',
  'battle', 'beach', 'bean', 'bear', 'beard', 'beat', 'beauty', 'because', 'become',
  'bed', 'before', 'begin', 'behind', 'believe', 'bell', 'belong', 'below', 'belt',
  'bench', 'bend', 'berry', 'beside', 'best', 'better', 'between', 'beyond', 'bicycle',
  'big', 'bike', 'bill', 'bind', 'bird', 'birth', 'birthday', 'bishop', 'bit', 'bite',
  'bitter', 'black', 'blade', 'blame', 'blank', 'blast', 'blend', 'bless', 'blind',
  'block', 'blood', 'bloom', 'blow', 'blue', 'board', 'boat', 'body', 'boil', 'bold',
  'bone', 'bonus', 'book', 'boost', 'boot', 'border', 'boring', 'borrow', 'boss', 'both',
  'bottle', 'bottom', 'bounce', 'bound', 'bowl', 'box', 'boy', 'brain', 'branch',
  'brave', 'bread', 'break', 'breath', 'breeze', 'brick', 'bridge', 'brief', 'bright',
  'bring', 'broad', 'broken', 'bronze', 'brother', 'brown', 'brush', 'bubble', 'bucket',
  'budget', 'build', 'bullet', 'bunch', 'burden', 'burn', 'burst', 'bury', 'bus',
  'business', 'busy', 'butter', 'button', 'buy', 'cabin', 'cable', 'cake', 'call',
  'calm', 'camera', 'camp', 'canal', 'candle', 'candy', 'canvas', 'cap', 'capital',
  'captain', 'car', 'carbon', 'card', 'care', 'career', 'careful', 'cargo', 'carpet',
  'carrot', 'carry', 'case', 'cash', 'castle', 'cat', 'catch', 'cause', 'cave', 'cease',
  'cedar', 'ceiling', 'cell', 'cement', 'center', 'century', 'cereal', 'certain',
  'chain', 'chair', 'chalk', 'champion', 'chance', 'change', 'channel', 'chapter',
  'charge', 'charity', 'charm', 'chart', 'chase', 'cheap', 'check', 'cheese', 'chef',
  'cherry', 'chess', 'chest', 'chicken', 'chief', 'child', 'children', 'china',
  'chocolate', 'choice', 'choose', 'church', 'circle', 'circus', 'citizen', 'city',
  'civil', 'claim', 'clash', 'class', 'classic', 'clean', 'clear', 'clever', 'click',
  'client', 'cliff', 'climate', 'climb', 'clinic', 'clock', 'close', 'cloth', 'cloud',
  'club', 'clue', 'coach', 'coast', 'coat', 'cobalt', 'coffee', 'coin', 'cold',
  'collect', 'college', 'colony', 'colour', 'column', 'combine', 'come', 'comedy',
  'comfort', 'comic', 'command', 'comment', 'commit', 'common', 'company', 'compare',
  'compete', 'complain', 'complete', 'complex', 'compute', 'computer', 'concept',
  'concern', 'concert', 'conclude', 'concrete', 'condition', 'conduct', 'confirm',
  'conflict', 'confuse', 'congress', 'connect', 'consider', 'consist', 'contact',
  'contain', 'content', 'contest', 'context', 'continue', 'contract', 'control',
  'convert', 'cook', 'cookie', 'cool', 'copper', 'copy', 'coral', 'core', 'corn',
  'corner', 'correct', 'cost', 'cotton', 'couch', 'could', 'council', 'count',
  'counter', 'country', 'county', 'couple', 'courage', 'course', 'court', 'cousin',
  'cover', 'cow', 'crack', 'craft', 'crash', 'crazy', 'cream', 'create', 'credit',
  'creek', 'crew', 'cricket', 'crime', 'crisis', 'crisp', 'critic', 'crop', 'cross',
  'crowd', 'crown', 'crucial', 'cruel', 'crush', 'crystal', 'cube', 'culture', 'cup',
  'cure', 'curious', 'current', 'curtain', 'curve', 'custom', 'customer', 'cut',
  'cycle', 'daily', 'dairy', 'damage', 'dance', 'danger', 'dare', 'dark', 'data',
  'date', 'daughter', 'dawn', 'day', 'dead', 'deal', 'dear', 'death', 'debate',
  'debt', 'decade', 'December', 'decide', 'declare', 'decline', 'decorate', 'decrease',
  'deep', 'deer', 'defeat', 'defend', 'define', 'degree', 'delay', 'deliver', 'demand',
  'deny', 'depart', 'depend', 'deposit', 'depth', 'derive', 'describe', 'desert',
  'deserve', 'design', 'desire', 'desk', 'despair', 'despite', 'destroy', 'detail',
  'detect', 'develop', 'device', 'devote', 'diagram', 'dial', 'diamond', 'diary',
  'dictionary', 'diet', 'differ', 'different', 'difficult', 'dig', 'digital', 'dinner',
  'direct', 'dirt', 'dirty', 'disaster', 'disc', 'discuss', 'disease', 'dish',
  'dismiss', 'display', 'distance', 'distinct', 'disturb', 'divide', 'division',
  'divorce', 'dock', 'doctor', 'document', 'dog', 'dollar', 'domain', 'domestic',
  'dominant', 'donate', 'door', 'double', 'doubt', 'down', 'dozen', 'draft', 'drag',
  'dragon', 'drain', 'drama', 'draw', 'drawer', 'dream', 'dress', 'drift', 'drill',
  'drink', 'drive', 'driver', 'drop', 'drown', 'drug', 'drum', 'dry', 'duck', 'due',
  'dull', 'dust', 'duty', 'each', 'eager', 'eagle', 'ear', 'early', 'earn', 'earth',
  'ease', 'east', 'easy', 'eat', 'echo', 'economy', 'edge', 'edit', 'educate', 'effect',
  'effort', 'egg', 'eight', 'either', 'elbow', 'elder', 'elect', 'electric', 'elegant',
  'element', 'elephant', 'elevator', 'elite', 'else', 'email', 'embrace', 'emerge',
  'emergency', 'emotion', 'emperor', 'empire', 'employ', 'empty', 'enable', 'encounter',
  'encourage', 'end', 'enemy', 'energy', 'enforce', 'engage', 'engine', 'engineer',
  'english', 'enhance', 'enjoy', 'enormous', 'enough', 'enquiry', 'ensure', 'enter',
  'entire', 'entry', 'envelope', 'equal', 'equip', 'error', 'escape', 'essay',
  'essential', 'establish', 'estate', 'estimate', 'ethnic', 'even', 'evening', 'event',
  'eventually', 'ever', 'every', 'evidence', 'evil', 'exact', 'exam', 'example',
  'exceed', 'excellent', 'except', 'exchange', 'excite', 'exclude', 'excuse', 'execute',
  'exercise', 'exhaust', 'exhibit', 'exist', 'exit', 'expand', 'expect', 'expense',
  'expensive', 'experience', 'experiment', 'expert', 'explain', 'explore', 'export',
  'expose', 'express', 'extend', 'extent', 'external', 'extra', 'extreme', 'eye',
  'fabric', 'face', 'facility', 'fact', 'factor', 'factory', 'fade', 'fail', 'fair',
  'faith', 'fall', 'false', 'fame', 'familiar', 'family', 'famous', 'fan', 'fancy',
  'fantasy', 'far', 'farm', 'fashion', 'fast', 'fat', 'fatal', 'fate', 'father',
  'fault', 'favour', 'fear', 'feast', 'feature', 'February', 'fee', 'feed', 'feel',
  'fellow', 'female', 'fence', 'festival', 'fetch', 'fever', 'few', 'field', 'fierce',
  'fight', 'figure', 'file', 'fill', 'film', 'filter', 'final', 'finance', 'find',
  'fine', 'finger', 'finish', 'fire', 'firm', 'first', 'fish', 'fitness', 'five',
  'fix', 'flag', 'flame', 'flash', 'flat', 'flavour', 'fleet', 'flesh', 'flight',
  'float', 'flock', 'flood', 'floor', 'flour', 'flow', 'flower', 'fluid', 'fly',
  'focus', 'fold', 'folk', 'follow', 'food', 'fool', 'foot', 'football', 'force',
  'forecast', 'foreign', 'forest', 'forever', 'forget', 'forgive', 'fork', 'form',
  'formal', 'former', 'formula', 'fortune', 'forward', 'fossil', 'foster', 'found',
  'foundation', 'fountain', 'four', 'fox', 'fraction', 'frame', 'free', 'freedom',
  'freeze', 'frequent', 'fresh', 'friend', 'frighten', 'frog', 'from', 'front',
  'frozen', 'fruit', 'fuel', 'full', 'fun', 'function', 'fund', 'funeral', 'funny',
  'furniture', 'further', 'future', 'gain', 'galaxy', 'gallery', 'game', 'gang',
  'gap', 'garage', 'garden', 'gas', 'gate', 'gather', 'gaze', 'gear', 'gender',
  'general', 'generate', 'generous', 'gentle', 'genuine', 'gesture', 'get', 'ghost',
  'giant', 'gift', 'ginger', 'girl', 'give', 'glacier', 'glad', 'glance', 'glass',
  'glimpse', 'global', 'globe', 'glory', 'glove', 'goal', 'goat', 'gold', 'golden',
  'golf', 'good', 'govern', 'grab', 'grace', 'grade', 'grain', 'grand', 'grant',
  'grape', 'graph', 'grasp', 'grass', 'grateful', 'grave', 'gravity', 'great',
  'green', 'greet', 'grey', 'grief', 'grin', 'grip', 'grocery', 'ground', 'group',
  'grow', 'growth', 'guard', 'guess', 'guest', 'guide', 'guilt', 'guitar', 'gun',
  'habit', 'hair', 'half', 'hall', 'halt', 'hammer', 'hand', 'handle', 'hang',
  'happen', 'happy', 'harbour', 'hard', 'harm', 'harsh', 'harvest', 'hat', 'hate',
  'have', 'hazard', 'head', 'health', 'heap', 'hear', 'heart', 'heat', 'heaven',
  'heavy', 'heel', 'height', 'helicopter', 'hello', 'helmet', 'help', 'hen', 'herb',
  'herd', 'here', 'hero', 'hide', 'high', 'highlight', 'highway', 'hill', 'hint',
  'hire', 'history', 'hit', 'hobby', 'hold', 'hole', 'holiday', 'hollow', 'home',
  'honest', 'honey', 'honour', 'hook', 'hope', 'horizon', 'horn', 'horrible',
  'horror', 'horse', 'hospital', 'host', 'hotel', 'hour', 'house', 'however', 'huge',
  'human', 'humble', 'humour', 'hundred', 'hunger', 'hungry', 'hunt', 'hunter',
  'hurry', 'hurt', 'husband', 'hut', 'ice', 'icon', 'idea', 'ideal', 'identify',
  'identity', 'idle', 'ignore', 'illness', 'image', 'imagine', 'imitate', 'immediate',
  'immense', 'impact', 'import', 'important', 'impose', 'impossible', 'impress',
  'improve', 'impulse', 'inch', 'incident', 'include', 'income', 'increase',
  'indeed', 'index', 'indicate', 'individual', 'industry', 'infant', 'infect',
  'infer', 'inflation', 'inform', 'initial', 'inject', 'injure', 'injury', 'inner',
  'innocent', 'insect', 'insert', 'inside', 'insight', 'insist', 'inspect',
  'inspire', 'install', 'instance', 'instant', 'instead', 'institute', 'instruct',
  'instrument', 'insult', 'insurance', 'intend', 'intense', 'interest', 'interior',
  'internal', 'internet', 'interpret', 'interrupt', 'interview', 'into', 'introduce',
  'invade', 'invent', 'invest', 'invite', 'involve', 'iron', 'island', 'isolate',
  'issue', 'item', 'jacket', 'jaguar', 'jail', 'January', 'jazz', 'jelly', 'jewel',
  'job', 'join', 'joint', 'joke', 'journal', 'journey', 'joy', 'judge', 'juice',
  'July', 'jump', 'June', 'jungle', 'junior', 'jury', 'justice', 'keen', 'keep',
  'kettle', 'key', 'keyboard', 'kick', 'kid', 'kill', 'kilometre', 'kind', 'king',
  'kiss', 'kitchen', 'kite', 'knee', 'knife', 'knock', 'knot', 'know', 'knowledge',
  'label', 'laboratory', 'labour', 'lace', 'lack', 'ladder', 'lady', 'lake', 'lamp',
  'land', 'landscape', 'lane', 'language', 'lantern', 'large', 'laser', 'last',
  'late', 'later', 'latter', 'laugh', 'launch', 'laundry', 'law', 'lawn', 'lawyer',
  'lay', 'layer', 'lazy', 'lead', 'leader', 'leaf', 'league', 'lean', 'leap',
  'learn', 'lease', 'least', 'leather', 'leave', 'lecture', 'left', 'leg', 'legal',
  'legend', 'leisure', 'lemon', 'lend', 'length', 'lens', 'less', 'lesson', 'letter',
  'level', 'liberty', 'library', 'licence', 'lid', 'lie', 'life', 'lift', 'light',
  'like', 'likely', 'limb', 'limit', 'line', 'link', 'lion', 'lip', 'liquid', 'list',
  'listen', 'literature', 'little', 'live', 'lively', 'load', 'loan', 'lobby',
  'local', 'locate', 'lock', 'log', 'logic', 'lonely', 'long', 'look', 'loop',
  'loose', 'lord', 'lose', 'loss', 'lost', 'lot', 'loud', 'love', 'lovely', 'lower',
  'loyal', 'luck', 'lucky', 'luggage', 'lunch', 'lung', 'luxury', 'machine', 'mad',
  'magazine', 'magic', 'magnet', 'mail', 'main', 'major', 'make', 'male', 'mall',
  'manage', 'manner', 'manual', 'manufacture', 'many', 'map', 'maple', 'marble',
  'march', 'March', 'margin', 'marine', 'mark', 'market', 'marriage', 'marry',
  'mask', 'mass', 'massive', 'master', 'match', 'mate', 'material', 'matter',
  'mature', 'maximum', 'maybe', 'mayor', 'meal', 'mean', 'meaning', 'measure',
  'meat', 'mechanic', 'medal', 'media', 'medical', 'medicine', 'medium', 'meet',
  'melody', 'melt', 'member', 'memory', 'mend', 'mental', 'mention', 'menu',
  'mercy', 'mere', 'merge', 'merit', 'merry', 'mess', 'message', 'metal', 'meter',
  'method', 'middle', 'midnight', 'might', 'mild', 'mile', 'military', 'milk',
  'mill', 'million', 'mind', 'mine', 'mineral', 'minimum', 'minister', 'minor',
  'mint', 'minute', 'miracle', 'mirror', 'misery', 'miss', 'mission', 'mistake',
  'mix', 'mixture', 'mobile', 'mode', 'model', 'moderate', 'modern', 'modest',
  'modify', 'moist', 'moment', 'Monday', 'money', 'monitor', 'monkey', 'month',
  'monument', 'mood', 'moon', 'moral', 'more', 'morning', 'mortal', 'mosquito',
  'most', 'mother', 'motion', 'motor', 'mount', 'mountain', 'mouse', 'mouth',
  'move', 'movie', 'much', 'mud', 'multiple', 'murder', 'muscle', 'museum',
  'music', 'musical', 'must', 'mutual', 'myself', 'mystery', 'nail', 'naked',
  'name', 'narrow', 'nation', 'native', 'natural', 'nature', 'naughty', 'naval',
  'near', 'neat', 'necessary', 'neck', 'need', 'negative', 'neglect', 'neighbour',
  'neither', 'nephew', 'nerve', 'nervous', 'nest', 'net', 'network', 'neutral',
  'never', 'nevertheless', 'new', 'news', 'newspaper', 'next', 'nice', 'niece',
  'night', 'nine', 'noble', 'nobody', 'nod', 'noise', 'nominal', 'none', 'noon',
  'normal', 'north', 'nose', 'note', 'nothing', 'notice', 'notion', 'novel',
  'November', 'now', 'nowhere', 'nuclear', 'number', 'numerous', 'nurse', 'nut',
  'oak', 'obey', 'object', 'observe', 'obtain', 'obvious', 'occasion', 'occupy',
  'occur', 'ocean', 'October', 'odd', 'off', 'offence', 'offer', 'office',
  'officer', 'official', 'often', 'oil', 'old', 'olive', 'onion', 'only', 'onward',
  'open', 'opera', 'operate', 'opinion', 'opponent', 'opportunity', 'oppose',
  'opposite', 'option', 'orange', 'orbit', 'orchestra', 'order', 'ordinary',
  'organ', 'organise', 'origin', 'other', 'otherwise', 'ought', 'ounce', 'outcome',
  'outline', 'output', 'outside', 'oven', 'over', 'overall', 'owe', 'owl', 'own',
  'owner', 'oxygen', 'pace', 'pack', 'package', 'page', 'pain', 'paint', 'pair',
  'palace', 'pale', 'palm', 'panel', 'panic', 'paper', 'parade', 'parallel',
  'parent', 'park', 'parliament', 'part', 'partial', 'particular', 'partner',
  'party', 'pass', 'passage', 'passenger', 'passion', 'past', 'pasture', 'patch',
  'path', 'patience', 'patient', 'pattern', 'pause', 'pave', 'payment', 'peace',
  'peak', 'pear', 'pearl', 'peasant', 'peculiar', 'pen', 'penalty', 'pencil',
  'people', 'pepper', 'per', 'perceive', 'percent', 'perfect', 'perform', 'perhaps',
  'period', 'permanent', 'permit', 'person', 'personal', 'persuade', 'pet', 'phase',
  'phenomenon', 'philosophy', 'phone', 'photo', 'phrase', 'physical', 'physics',
  'piano', 'pick', 'picnic', 'picture', 'piece', 'pig', 'pigeon', 'pile', 'pill',
  'pillow', 'pilot', 'pin', 'pine', 'pink', 'pioneer', 'pipe', 'pistol', 'pitch',
  'pity', 'pizza', 'place', 'plain', 'plan', 'plane', 'planet', 'plant', 'plastic',
  'plate', 'platform', 'play', 'player', 'plead', 'pleasant', 'please', 'pleasure',
  'plenty', 'plot', 'plough', 'plug', 'plunge', 'plus', 'pocket', 'poem', 'poet',
  'point', 'poison', 'pole', 'police', 'policy', 'polish', 'polite', 'political',
  'politics', 'poll', 'pond', 'pool', 'poor', 'pop', 'popular', 'population',
  'porch', 'port', 'portion', 'portrait', 'pose', 'position', 'positive',
  'possess', 'possible', 'post', 'pot', 'potato', 'potential', 'pound', 'pour',
  'poverty', 'powder', 'power', 'powerful', 'practical', 'practice', 'praise',
  'pray', 'prayer', 'precise', 'predict', 'prefer', 'prepare', 'present',
  'preserve', 'president', 'press', 'pressure', 'pretend', 'pretty', 'prevent',
  'previous', 'price', 'pride', 'priest', 'primary', 'prime', 'prince', 'princess',
  'principal', 'principle', 'print', 'printer', 'prior', 'priority', 'prison',
  'prisoner', 'privacy', 'private', 'prize', 'probable', 'problem', 'proceed',
  'process', 'produce', 'product', 'profession', 'professor', 'profile', 'profit',
  'program', 'progress', 'project', 'promise', 'promote', 'prompt', 'proof',
  'proper', 'property', 'propose', 'prospect', 'protect', 'protein', 'protest',
  'proud', 'prove', 'provide', 'province', 'public', 'publish', 'pull', 'pulse',
  'pump', 'punch', 'punish', 'pupil', 'purchase', 'pure', 'purple', 'purpose',
  'pursue', 'push', 'put', 'puzzle', 'qualify', 'quality', 'quantity', 'quarrel',
  'quarter', 'queen', 'question', 'queue', 'quick', 'quiet', 'quit', 'quite',
  'quota', 'quote', 'rabbit', 'race', 'racial', 'radio', 'rail', 'railway', 'rain',
  'raise', 'rally', 'random', 'range', 'rank', 'rapid', 'rare', 'rat', 'rate',
  'rather', 'rating', 'ratio', 'raw', 'ray', 'reach', 'react', 'read', 'reader',
  'ready', 'real', 'realise', 'reality', 'reason', 'recall', 'receipt', 'receive',
  'recent', 'recipe', 'recognise', 'recommend', 'record', 'recover', 'red',
  'reduce', 'refer', 'reflect', 'reform', 'refuse', 'regard', 'region', 'register',
  'regret', 'regular', 'reject', 'relate', 'relative', 'relax', 'release',
  'relevant', 'relief', 'religion', 'rely', 'remain', 'remark', 'remedy',
  'remember', 'remind', 'remote', 'remove', 'render', 'rent', 'repair', 'repeat',
  'replace', 'reply', 'report', 'reporter', 'represent', 'republic', 'reputation',
  'request', 'require', 'rescue', 'research', 'reserve', 'resident', 'resist',
  'resolve', 'resort', 'resource', 'respect', 'respond', 'response', 'rest',
  'restore', 'restrict', 'result', 'retain', 'retire', 'return', 'reveal',
  'reverse', 'review', 'revise', 'revolution', 'reward', 'rhythm', 'ribbon',
  'rice', 'rich', 'rid', 'ride', 'ridge', 'ridiculous', 'rifle', 'right', 'rigid',
  'ring', 'riot', 'rise', 'risk', 'ritual', 'rival', 'river', 'road', 'roar',
  'roast', 'rob', 'robot', 'rock', 'rocket', 'rod', 'role', 'roll', 'romantic',
  'roof', 'room', 'root', 'rope', 'rose', 'rot', 'rough', 'round', 'route',
  'routine', 'row', 'royal', 'rub', 'rubber', 'rude', 'rug', 'rule', 'ruler',
  'rumour', 'run', 'rural', 'rush', 'rust', 'sack', 'sacred', 'sacrifice', 'sad',
  'safe', 'safety', 'sail', 'sailor', 'saint', 'sake', 'salad', 'salary', 'sale',
  'salt', 'same', 'sample', 'sand', 'satisfy', 'Saturday', 'sauce', 'save',
  'saving', 'say', 'scale', 'scan', 'scarce', 'scare', 'scatter', 'scene',
  'schedule', 'scheme', 'scholar', 'school', 'science', 'scientist', 'scope',
  'score', 'scratch', 'scream', 'screen', 'script', 'sea', 'search', 'season',
  'seat', 'second', 'secret', 'secretary', 'section', 'sector', 'secure',
  'security', 'see', 'seed', 'seek', 'seem', 'seize', 'seldom', 'select', 'self',
  'sell', 'senate', 'send', 'senior', 'sense', 'sentence', 'separate',
  'September', 'sequence', 'series', 'serious', 'servant', 'serve', 'service',
  'session', 'set', 'settle', 'seven', 'several', 'severe', 'sew', 'shade',
  'shadow', 'shake', 'shall', 'shallow', 'shame', 'shape', 'share', 'shark',
  'sharp', 'shave', 'sheep', 'sheet', 'shelf', 'shell', 'shelter', 'shift',
  'shine', 'ship', 'shirt', 'shock', 'shoe', 'shoot', 'shop', 'shore', 'short',
  'shot', 'should', 'shoulder', 'shout', 'show', 'shower', 'shrink', 'shut',
  'shy', 'sick', 'side', 'sight', 'sign', 'signal', 'significant', 'silence',
  'silent', 'silk', 'silly', 'silver', 'similar', 'simple', 'since', 'sincere',
  'sing', 'singer', 'single', 'sink', 'sir', 'sister', 'sit', 'site',
  'situation', 'six', 'size', 'sketch', 'ski', 'skill', 'skin', 'skirt', 'sky',
  'slave', 'sleep', 'slice', 'slide', 'slight', 'slim', 'slip', 'slope', 'slow',
  'small', 'smart', 'smash', 'smell', 'smile', 'smoke', 'smooth', 'snake',
  'snap', 'snow', 'soap', 'social', 'society', 'sock', 'soft', 'software',
  'soil', 'solar', 'soldier', 'sole', 'solid', 'solution', 'solve', 'some',
  'somebody', 'somehow', 'someone', 'something', 'sometimes', 'somewhat',
  'somewhere', 'son', 'song', 'soon', 'sore', 'sorrow', 'sorry', 'sort', 'soul',
  'sound', 'soup', 'sour', 'source', 'south', 'space', 'spare', 'spark', 'speak',
  'speaker', 'special', 'species', 'specific', 'specify', 'specimen', 'spectrum',
  'speech', 'speed', 'spell', 'spend', 'sphere', 'spice', 'spider', 'spirit',
  'spite', 'split', 'spoil', 'sponsor', 'spoon', 'sport', 'spot', 'spray',
  'spread', 'spring', 'square', 'squeeze', 'stable', 'stack', 'staple', 'starch', 'statue', 'staff', 'stage',
  'stair', 'stake', 'stamp', 'stand', 'standard', 'star', 'stare', 'start',
  'state', 'station', 'statue', 'status', 'stay', 'steady', 'steal', 'steam',
  'steel', 'steep', 'steer', 'stem', 'step', 'stick', 'stiff', 'still', 'sting',
  'stir', 'stock', 'stomach', 'stone', 'stop', 'store', 'storm', 'story',
  'stove', 'straight', 'strain', 'strange', 'stranger', 'strategy', 'straw',
  'stream', 'street', 'strength', 'stress', 'stretch', 'strike', 'string',
  'strip', 'stroke', 'strong', 'structure', 'struggle', 'student', 'studio',
  'study', 'stuff', 'stupid', 'style', 'subject', 'submit', 'substance',
  'succeed', 'success', 'such', 'sudden', 'suffer', 'sugar', 'suggest', 'suit',
  'suitable', 'sum', 'summer', 'summit', 'sun', 'Sunday', 'sunset', 'sunshine',
  'super', 'supply', 'support', 'suppose', 'sure', 'surface', 'surgery',
  'surprise', 'surround', 'survey', 'survive', 'suspect', 'suspend', 'swallow',
  'swear', 'sweep', 'sweet', 'swim', 'swing', 'switch', 'sword', 'symbol',
  'sympathy', 'system', 'table', 'tablet', 'tackle', 'tail', 'tailor', 'take',
  'tale', 'talent', 'talk', 'tall', 'tank', 'tape', 'target', 'task', 'taste',
  'tax', 'taxi', 'tea', 'teach', 'teacher', 'team', 'tear', 'technical',
  'technique', 'technology', 'telephone', 'television', 'tell', 'temper',
  'temperature', 'temple', 'temporary', 'tempt', 'ten', 'tenant', 'tend', 'tender',
  'tennis', 'tense', 'tension', 'tent', 'term', 'terrible', 'territory', 'terror',
  'test', 'text', 'than', 'thank', 'that', 'theatre', 'their', 'theme',
  'themselves', 'then', 'theory', 'there', 'therefore', 'these', 'they', 'thick',
  'thief', 'thin', 'thing', 'think', 'third', 'thirst', 'this', 'thorough',
  'those', 'though', 'thought', 'thousand', 'thread', 'threat', 'three',
  'threshold', 'throat', 'through', 'throw', 'thumb', 'thunder', 'Thursday',
  'thus', 'ticket', 'tide', 'tidy', 'tie', 'tight', 'tile', 'till', 'timber',
  'time', 'tiny', 'tip', 'tire', 'tired', 'title', 'today', 'toe', 'together',
  'toilet', 'tolerance', 'tomato', 'tomorrow', 'tone', 'tongue', 'tonight',
  'tool', 'tooth', 'top', 'topic', 'total', 'touch', 'tough', 'tour', 'tourist',
  'towards', 'towel', 'tower', 'town', 'toy', 'trace', 'track', 'trade',
  'tradition', 'traffic', 'tragedy', 'trail', 'train', 'transfer', 'transform',
  'translate', 'transport', 'trap', 'travel', 'tray', 'treasure', 'treat',
  'treaty', 'tree', 'tremble', 'trend', 'trial', 'triangle', 'tribe', 'trick',
  'trigger', 'trip', 'triumph', 'troop', 'tropical', 'trouble', 'troubador',
  'troubadour', 'truck', 'true', 'truly', 'trust', 'truth', 'try', 'tube',
  'Tuesday', 'tune', 'tunnel', 'turkey', 'turn', 'twelve', 'twenty', 'twice',
  'twin', 'twist', 'two', 'type', 'typical', 'ugly', 'ultimate', 'uncle',
  'under', 'undergo', 'understand', 'undertake', 'unfair', 'unfortunate',
  'uniform', 'union', 'unique', 'unit', 'unite', 'universe', 'university',
  'unknown', 'unless', 'unlike', 'until', 'unusual', 'up', 'update', 'upon',
  'upper', 'upset', 'urban', 'urge', 'urgent', 'usage', 'use', 'useful', 'usual',
  'utility', 'utter', 'vacation', 'vacuum', 'vague', 'valid', 'valley', 'value',
  'van', 'vanish', 'variety', 'various', 'vary', 'vast', 'vehicle', 'venture',
  'verb', 'verify', 'version', 'very', 'vessel', 'veteran', 'via', 'victim',
  'victory', 'video', 'view', 'village', 'violence', 'violent', 'virtual',
  'virtue', 'virus', 'visible', 'vision', 'visit', 'visitor', 'visual', 'vital',
  'vivid', 'vocabulary', 'voice', 'volume', 'volunteer', 'vote', 'voyage',
  'wage', 'wagon', 'waist', 'wait', 'wake', 'walk', 'wall', 'walnut', 'wander',
  'want', 'war', 'ward', 'warm', 'warn', 'warrant', 'wash', 'waste', 'watch',
  'water', 'wave', 'way', 'weak', 'wealth', 'weapon', 'wear', 'weather',
  'weave', 'wedding', 'Wednesday', 'weed', 'week', 'weekend', 'weigh', 'weight',
  'weird', 'welcome', 'welfare', 'well', 'west', 'wet', 'whale', 'what',
  'wheat', 'wheel', 'when', 'whenever', 'where', 'whereas', 'whether', 'which',
  'while', 'whilst', 'whip', 'whisper', 'whistle', 'white', 'who', 'whole',
  'whom', 'whose', 'why', 'wide', 'widow', 'width', 'wife', 'wild', 'will',
  'willing', 'win', 'wind', 'window', 'wine', 'wing', 'winner', 'winter',
  'wipe', 'wire', 'wisdom', 'wise', 'wish', 'wit', 'with', 'withdraw', 'within',
  'without', 'witness', 'wolf', 'woman', 'wonder', 'wood', 'wooden', 'wool',
  'word', 'work', 'worker', 'world', 'worm', 'worry', 'worse', 'worship',
  'worst', 'worth', 'worthy', 'would', 'wound', 'wrap', 'wreck', 'wrist',
  'write', 'writer', 'wrong', 'yard', 'yawn', 'year', 'yell', 'yellow', 'yes',
  'yesterday', 'yet', 'yield', 'young', 'youth', 'zero', 'zone',
];

const COMMON_WORD_SET = new Set(COMMON_WORDS);

/**
 * Bits charged for a listed word: log2(2048) = 11.
 *
 * 2048 is the word-list size XKCD #936 uses for its passphrase arithmetic, and
 * it is the right order of magnitude for "a word an attacker's dictionary will
 * contain". Charging the word's own frequency rank would be better, but the list
 * above is not a frequency corpus and pretending otherwise would invent
 * precision; a flat 11 bits understates rare words, which is the safe direction.
 * The same number makes four random words worth 44 bits, matching the comic.
 */
export const COMMON_WORD_BITS = Math.log2(2048);
export const COMMON_WORD_COUNT = COMMON_WORDS.length;

/** Minimum length before a letters-only run is treated as a candidate word. */
const MIN_WORD_LENGTH = 4;
const MAX_WORD_LENGTH = 20;
const MAX_DICTIONARY_LENGTH = 24;
const MIN_KEYBOARD_RUN = 3;
const MIN_SEQUENCE_RUN = 3;
const MAX_REPEAT_UNIT = 6;
/**
 * Longest run of repetitions that gets its own candidate, and the most repeats
 * counted. A hundred `x` characters are still cheap to describe, but by chaining
 * eight-repeat blocks in the dynamic program rather than by emitting one
 * candidate per possible length. Without these caps a 1000-character run would
 * generate O(n²) candidates and take minutes, which is exactly what a strength
 * meter must not do while someone is typing.
 */
const MAX_REPEAT_COUNT = 8;
const MAX_REPEAT_SPAN = 48;

const YEAR_MIN = 1900;
const YEAR_MAX = 2035;
const YEAR_POOL = YEAR_MAX - YEAR_MIN + 1;
const DATE_POOL = YEAR_POOL * 366;

/** Each leet substitution is worth log2(3): about three plausible spellings. */
export const LEET_SUBSTITUTION_BITS = Math.log2(3);

/** Rows used for the keyboard-run pool: digits plus three letter rows. */
const KEYBOARD_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'] as const;
const KEYBOARD_BITS = Math.log2(KEYBOARD_ROWS.length * 11 * 8);

const SEQUENCE_ALPHABETS = ['abcdefghijklmnopqrstuvwxyz', '0123456789'] as const;
const SEQUENCE_BITS = Math.log2(SEQUENCE_ALPHABETS.length * 26 * 8 * 2);

const LEET_FOLD: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
};

export type CharClass =
  | 'lowercase'
  | 'uppercase'
  | 'digits'
  | 'symbols'
  | 'spaces'
  | 'other';

export const CHAR_CLASS_LABELS: Record<CharClass, string> = {
  lowercase: '小写字母',
  uppercase: '大写字母',
  digits: '数字',
  symbols: '符号',
  spaces: '空格',
  other: '其它 Unicode',
};

const LOWER_POOL = 26;
const UPPER_POOL = 26;
const DIGIT_POOL = 10;
const SPACE_POOL = 1;
/** Printable ASCII punctuation, excluding the space (95 printable - 62 - 1). */
const SYMBOL_POOL = 32;
const DEFAULT_UNICODE_POOL = 256;

interface UnicodeBlock {
  from: number;
  to: number;
  size: number;
  label: string;
}

const UNICODE_BLOCKS: readonly UnicodeBlock[] = [
  { from: 0x00a1, to: 0x024f, size: 448, label: '带变音符的拉丁字母' },
  { from: 0x0370, to: 0x03ff, size: 144, label: '希腊字母' },
  { from: 0x0400, to: 0x04ff, size: 256, label: '西里尔字母' },
  { from: 0x0590, to: 0x05ff, size: 112, label: '希伯来字母' },
  { from: 0x0600, to: 0x06ff, size: 256, label: '阿拉伯字母' },
  { from: 0x0900, to: 0x097f, size: 128, label: '天城文' },
  { from: 0x3040, to: 0x30ff, size: 192, label: '日文假名' },
  { from: 0x3400, to: 0x4dbf, size: 6592, label: '中日韩扩展 A' },
  { from: 0x4e00, to: 0x9fff, size: 20992, label: '中日韩统一表意文字' },
  { from: 0xac00, to: 0xd7af, size: 11172, label: '谚文音节' },
  { from: 0x2000, to: 0x206f, size: 112, label: '常用标点' },
  { from: 0x20a0, to: 0x20cf, size: 48, label: '货币符号' },
  { from: 0x2100, to: 0x214f, size: 80, label: '字母式符号' },
  { from: 0x1f300, to: 0x1faff, size: 2048, label: 'Emoji 与符号' },
];

export function classifyCodePoint(codePoint: number): CharClass {
  if (codePoint >= 0x61 && codePoint <= 0x7a) return 'lowercase';
  if (codePoint >= 0x41 && codePoint <= 0x5a) return 'uppercase';
  if (codePoint >= 0x30 && codePoint <= 0x39) return 'digits';
  if (codePoint === 0x20) return 'spaces';
  if (codePoint >= 0x21 && codePoint <= 0x7e) return 'symbols';
  return 'other';
}

export interface Composition {
  counts: Record<CharClass, number>;
  /** Size of the character set the password would be drawn from. */
  poolSize: number;
  /** How much of `poolSize` each class contributes (0 when unused). */
  poolByClass: Record<CharClass, number>;
  classes: CharClass[];
  unicodeBlocks: string[];
  distinctChars: number;
}

/**
 * Splits the password into character classes and derives the pool size.
 *
 * The pool for non-ASCII characters is the sum of the Unicode blocks actually
 * used, not the whole of Unicode: "密码123" is not drawn from a million
 * codepoints, it is drawn from Han characters plus digits.
 */
export function describeComposition(password: string): Composition {
  const counts: Record<CharClass, number> = {
    lowercase: 0,
    uppercase: 0,
    digits: 0,
    symbols: 0,
    spaces: 0,
    other: 0,
  };
  const blocks = new Set<string>();
  const distinct = new Set<string>();
  let unmatchedOther = false;

  for (const char of password) {
    const codePoint = char.codePointAt(0) ?? 0;
    const charClass = classifyCodePoint(codePoint);
    counts[charClass] += 1;
    distinct.add(char);

    if (charClass === 'other') {
      const block = UNICODE_BLOCKS.find(
        (candidate) => codePoint >= candidate.from && codePoint <= candidate.to,
      );
      if (block) blocks.add(block.label);
      else unmatchedOther = true;
    }
  }

  const poolByClass: Record<CharClass, number> = {
    lowercase: counts.lowercase > 0 ? LOWER_POOL : 0,
    uppercase: counts.uppercase > 0 ? UPPER_POOL : 0,
    digits: counts.digits > 0 ? DIGIT_POOL : 0,
    symbols: counts.symbols > 0 ? SYMBOL_POOL : 0,
    spaces: counts.spaces > 0 ? SPACE_POOL : 0,
    other: 0,
  };

  let poolSize = 0;
  for (const key of Object.keys(poolByClass) as CharClass[]) poolSize += poolByClass[key];
  if (counts.other > 0) {
    let unicodePool = 0;
    for (const block of UNICODE_BLOCKS) {
      if (blocks.has(block.label)) unicodePool += block.size;
    }
    if (unmatchedOther) unicodePool += DEFAULT_UNICODE_POOL;
    poolByClass.other = unicodePool;
    poolSize += unicodePool;
  }

  const classes = (Object.keys(counts) as CharClass[]).filter(
    (key) => counts[key] > 0,
  );

  return {
    counts,
    poolSize,
    poolByClass,
    classes,
    unicodeBlocks: [...blocks],
    distinctChars: distinct.size,
  };
}

/** `length × log2(poolSize)` — the uniform-random upper bound. */
export function charsetEntropyBits(length: number, poolSize: number): number {
  if (length <= 0 || poolSize <= 1) return 0;
  return length * Math.log2(poolSize);
}

/** Lower-cases and folds leet substitutions back to letters. */
export function foldLeet(token: string): string {
  let out = '';
  for (const char of token.toLowerCase()) out += LEET_FOLD[char] ?? char;
  return out;
}

export type PatternKind =
  | 'weak-list'
  | 'word'
  | 'keyboard'
  | 'sequence'
  | 'repeat'
  | 'date'
  | 'year'
  | 'context'
  | 'brute-force';

export const PATTERN_KIND_LABELS: Record<PatternKind, string> = {
  'weak-list': '常见弱口令',
  word: '常见单词',
  keyboard: '键盘序',
  sequence: '字符序列',
  repeat: '重复',
  date: '日期',
  year: '年份',
  context: '上下文词',
  'brute-force': '穷举',
};

export interface Segment {
  kind: PatternKind;
  /** Start index in code points. */
  start: number;
  /** Length in code points. */
  length: number;
  /** The substring this segment covers. */
  text: string;
  /** Bits this segment contributes to the cover. */
  bits: number;
  label: string;
  detail: string;
}

export interface Finding {
  id: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
}

export interface AttackScenario {
  id: string;
  label: string;
  /** 每秒尝试次数；在线场景可以小于 1。 */
  guessesPerSecond: number;
  log10GuessesPerSecond: number;
  note: string;
}

/**
 * Attack costs, all order-of-magnitude.
 *
 * The three hash figures are the ones the tool is specified to show; real
 * hardware varies by an order of magnitude in either direction, and the online
 * figure depends entirely on the target's rate limiting.
 */
export const ATTACK_SCENARIOS: readonly AttackScenario[] = [
  {
    id: 'online',
    label: '在线撞库（有限速）',
    guessesPerSecond: 10 / 3600,
    log10GuessesPerSecond: Math.log10(10 / 3600),
    note: '按每小时 10 次登录尝试计；限速与锁定策略决定一切，实际可能更严也可能更松。',
  },
  {
    id: 'slow',
    label: '慢哈希（bcrypt / Argon2）',
    guessesPerSecond: 1e4,
    log10GuessesPerSecond: 4,
    note: '按单机 GPU 每秒 1 万次计，适用于正确加盐、迭代充分的慢哈希。',
  },
  {
    id: 'fast',
    label: '快哈希（MD5 / SHA-1）',
    guessesPerSecond: 1e10,
    log10GuessesPerSecond: 10,
    note: '按单张高端 GPU 每秒 100 亿次计；被盗库里的 MD5 通常就是这个场景。',
  },
  {
    id: 'cluster',
    label: '大规模 GPU 集群',
    guessesPerSecond: 1e13,
    log10GuessesPerSecond: 13,
    note: '按上千张 GPU 组成的集群、每秒 10^13 次计，国家级攻击者或大型破解服务的量级。',
  },
];

export interface CrackEstimate {
  id: string;
  label: string;
  note: string;
  /** 平均尝试次数的以 10 为底的对数。 */
  log10Seconds: number;
  /** 人类可读的时间，如“3 天”“约 10^12 年”。 */
  human: string;
}

/**
 * Formats seconds-given-as-a-logarithm.
 *
 * Working in log space is not decoration: `Math.pow(2, bits) / rate` overflows
 * to Infinity past ~1023 bits, and a 256-character password already has more
 * than 1000 bits. Keeping the exponent means a strong password reports a large
 * finite number instead of "Infinity 年".
 */
export function formatCrackTime(log10Seconds: number): string {
  if (!Number.isFinite(log10Seconds)) return '未知';
  if (log10Seconds < 0) return '不到 1 秒';

  const LOG10_YEAR = Math.log10(365.25 * 86400);
  const log10Years = log10Seconds - LOG10_YEAR;

  if (log10Seconds < Math.log10(60)) return `${Math.round(Math.pow(10, log10Seconds))} 秒`;
  if (log10Seconds < Math.log10(3600)) return `${Math.round(Math.pow(10, log10Seconds) / 60)} 分钟`;
  if (log10Seconds < Math.log10(86400)) {
    return `${Math.round(Math.pow(10, log10Seconds) / 3600)} 小时`;
  }
  if (log10Seconds < LOG10_YEAR) {
    return `${Math.round(Math.pow(10, log10Seconds) / 86400)} 天`;
  }
  if (log10Years < 3) return `${Math.round(Math.pow(10, log10Years))} 年`;
  if (log10Years < 6) return `${(Math.pow(10, log10Years - 3)).toFixed(1)} 千年`;
  if (log10Years < 9) return `${Math.pow(10, log10Years - 6).toFixed(1)} 百万年`;
  return `约 10^${Math.floor(log10Years)} 年`;
}

/**
 * Crack time per scenario.
 *
 * The average number of guesses is half the search space, i.e. `2^(bits-1)`,
 * which is why one bit is subtracted before converting to a logarithm. These
 * are order-of-magnitude estimates: one hash per guess, no per-target salt
 * reuse effects, no smart dictionary ordering, and the whole cost model is
 * "enumerate the space this model believes in".
 */
export function estimateCrackTimes(effectiveBits: number): CrackEstimate[] {
  const log2Guesses = Math.max(effectiveBits - 1, 0);
  const log10Guesses = log2Guesses * Math.log10(2);

  return ATTACK_SCENARIOS.map((scenario) => {
    const log10Seconds = log10Guesses - scenario.log10GuessesPerSecond;
    return {
      id: scenario.id,
      label: scenario.label,
      note: scenario.note,
      log10Seconds,
      human: formatCrackTime(log10Seconds),
    };
  });
}

export interface Suggestion {
  id: string;
  title: string;
  detail: string;
  /** 预计增加的熵（位）。0 表示这是习惯性建议而非熵收益。 */
  gainBits: number;
  recommended: boolean;
}

export interface Verdict {
  label: string;
  tone: 'danger' | 'warning' | 'success' | 'brand';
  summary: string;
}

/** Thresholds follow common guidance: 60 bits resists online guessing, 80+ offline. */
export function verdictFor(effectiveBits: number): Verdict {
  if (effectiveBits < 28) {
    return {
      label: '极弱',
      tone: 'danger',
      summary: '几乎立刻就会被破解，不要用于任何真实账号。',
    };
  }
  if (effectiveBits < 40) {
    return {
      label: '弱',
      tone: 'danger',
      summary: '挡得住在线猜测，但离线破解很快就能拿下。',
    };
  }
  if (effectiveBits < 60) {
    return {
      label: '一般',
      tone: 'warning',
      summary: '能抵御在线撞库，但不足以长期抵御离线破解。',
    };
  }
  if (effectiveBits < 80) {
    return {
      label: '强',
      tone: 'success',
      summary: '足以应对常见的在线与离线攻击。',
    };
  }
  if (effectiveBits < 100) {
    return {
      label: '很强',
      tone: 'success',
      summary: '适合作为长期使用的主密码。',
    };
  }
  return {
    label: '极强',
    tone: 'brand',
    summary: '强度远超需要，注意别记不住。',
  };
}

export interface CharRow {
  /** 1-based position in code points. */
  index: number;
  char: string;
  codePoint: string;
  className: CharClass;
  classLabel: string;
  segmentKind: PatternKind;
  segmentLabel: string;
}

export interface PasswordAnalysis {
  empty: boolean;
  /** Length in code points, so an emoji counts as one character. */
  length: number;
  utf16Length: number;
  composition: Composition;
  charsetBits: number;
  patternBits: number;
  effectiveBits: number;
  /** 平均尝试次数的以 2 为底的对数；用对数是为了避免 2^bits 溢出。 */
  log2Guesses: number;
  segments: Segment[];
  findings: Finding[];
  crackTimes: CrackEstimate[];
  suggestions: Suggestion[];
  verdict: Verdict;
  breakdown: CharRow[];
}

interface Candidate {
  start: number;
  end: number;
  kind: PatternKind;
  bits: number;
  label: string;
  detail: string;
}

interface ContextWord {
  word: string;
  folded: string[];
  rank: number;
}

interface MatchContext {
  pool: number;
  contextWords: ContextWord[];
  /** Memoised cheapest-cover cost for short fragments (repeat units). */
  memo: Map<string, number>;
}

const KEY_POSITIONS = new Map<string, { row: number; pos: number }>();
KEYBOARD_ROWS.forEach((row, rowIndex) => {
  for (let pos = 0; pos < row.length; pos += 1) {
    KEY_POSITIONS.set(row[pos], { row: rowIndex, pos });
  }
});

const SHIFTED_DIGITS: Record<string, string> = {
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
};

function keyboardBase(char: string): { base: string; shifted: boolean } {
  const shiftedDigit = SHIFTED_DIGITS[char];
  if (shiftedDigit) return { base: shiftedDigit, shifted: true };
  const lower = char.toLowerCase();
  return { base: lower, shifted: char !== lower };
}

function countDigits(chars: string[], start: number, length: number): boolean {
  for (let i = start; i < start + length; i += 1) {
    const codePoint = chars[i].codePointAt(0) ?? 0;
    if (codePoint < 0x30 || codePoint > 0x39) return false;
  }
  return true;
}

/** Days in a month, ignoring leap years except for February. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

interface DateGuess {
  text: string;
  year: number;
  month: number;
  day: number;
}

/** Parses two-digit years as 19xx when 60-99, otherwise 20xx. */
function expandYear(value: number): number {
  if (value >= 1000) return value;
  return value >= 60 ? 1900 + value : 2000 + value;
}

function validDate(year: number, month: number, day: number): boolean {
  if (year < YEAR_MIN || year > YEAR_MAX) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/** All plausible readings of a compact digit string as a date. */
function parseCompactDate(text: string): DateGuess[] {
  const guesses: DateGuess[] = [];
  const push = (year: number, month: number, day: number) => {
    if (validDate(year, month, day)) guesses.push({ text, year, month, day });
  };

  if (text.length === 8) {
    push(Number(text.slice(0, 4)), Number(text.slice(4, 6)), Number(text.slice(6, 8)));
    push(Number(text.slice(4, 8)), Number(text.slice(2, 4)), Number(text.slice(0, 2)));
    push(Number(text.slice(4, 8)), Number(text.slice(0, 2)), Number(text.slice(2, 4)));
  } else if (text.length === 6) {
    push(expandYear(Number(text.slice(0, 2))), Number(text.slice(2, 4)), Number(text.slice(4, 6)));
    push(expandYear(Number(text.slice(4, 6))), Number(text.slice(2, 4)), Number(text.slice(0, 2)));
    push(expandYear(Number(text.slice(4, 6))), Number(text.slice(0, 2)), Number(text.slice(2, 4)));
  }
  return guesses;
}

function reverse(text: string): string {
  return [...text].reverse().join('');
}

/** Bits added by leet substitutions, capitalisation and reversal. */
function variationBits(raw: string, folded: string): { bits: number; notes: string[] } {
  const rawChars = [...raw.toLowerCase()];
  const foldedChars = [...folded];
  const notes: string[] = [];
  let bits = 0;

  let leetCount = 0;
  for (let i = 0; i < rawChars.length && i < foldedChars.length; i += 1) {
    if (rawChars[i] !== foldedChars[i]) leetCount += 1;
  }
  if (leetCount > 0) {
    bits += leetCount * LEET_SUBSTITUTION_BITS;
    notes.push(`${leetCount} 处形近替换`);
  }

  const letters = [...raw].filter((char) => /[A-Za-z]/.test(char));
  if (letters.length > 0) {
    const allLower = letters.every((char) => char === char.toLowerCase());
    const allUpper = letters.every((char) => char === char.toUpperCase());
    const titleCase =
      !allLower && !allUpper && letters.slice(1).every((char) => char === char.toLowerCase());
    if (allLower) {
      // The dictionary entry is already lower-case, so lower-case spelling costs
      // nothing extra. Charging a bit here would tax every word for free.
    } else if (allUpper || titleCase) {
      bits += 1;
      notes.push('常见的大小写变化');
    } else {
      bits += 1 + Math.log2(letters.length);
      notes.push(`${letters.length} 个字母中有多处大写变化`);
    }
  }

  return { bits, notes };
}

function pushCandidate(list: Candidate[], candidate: Candidate): void {
  list.push(candidate);
}

function collectWeakListCandidates(chars: string[], candidates: Candidate[]): void {
  const length = chars.length;
  for (let start = 0; start < length; start += 1) {
    const remaining = Math.min(MAX_DICTIONARY_LENGTH, length - start);
    for (let size = 1; size <= remaining; size += 1) {
      const raw = chars.slice(start, start + size).join('');
      const lower = raw.toLowerCase();
      const directRank = WEAK_RANKS.get(lower);
      if (directRank !== undefined) {
        pushCandidate(candidates, {
          start,
          end: start + size,
          kind: 'weak-list',
          bits: Math.log2(directRank),
          label: `常见弱口令第 ${directRank} 位`,
          detail: `“${raw}”在公开弱口令榜单中排第 ${directRank} 位，攻击者几乎最先尝试它，只值 ${Math.log2(directRank).toFixed(1)} 位。`,
        });
      }

      const folded = foldLeet(raw);
      if (folded === lower || !/^[a-z]+$/.test(folded)) continue;
      const foldedRank = WEAK_RANKS.get(folded);
      if (foldedRank === undefined) continue;
      const variation = variationBits(raw, folded);
      const bits = Math.log2(foldedRank) + variation.bits;
      pushCandidate(candidates, {
        start,
        end: start + size,
        kind: 'weak-list',
        bits,
        label: `常见弱口令第 ${foldedRank} 位的变形`,
        detail: `“${raw}”是弱口令第 ${foldedRank} 位“${folded}”的变形（${variation.notes.join('、')}），只值 ${bits.toFixed(1)} 位。`,
      });
    }
  }
}

function collectWordCandidates(chars: string[], candidates: Candidate[]): void {
  const length = chars.length;
  for (let start = 0; start < length; start += 1) {
    const remaining = Math.min(MAX_WORD_LENGTH, length - start);
    for (let size = MIN_WORD_LENGTH; size <= remaining; size += 1) {
      const raw = chars.slice(start, start + size).join('');
      const folded = foldLeet(raw);
      if (!/^[a-z]+$/.test(folded)) continue;

      const forward = COMMON_WORD_SET.has(folded);
      const backward = !forward && COMMON_WORD_SET.has(reverse(folded));
      if (!forward && !backward) continue;

      const variation = variationBits(raw, folded);
      const bits = COMMON_WORD_BITS + variation.bits + (backward ? 1 : 0);
      const notes = [...variation.notes];
      if (backward) notes.push('倒序拼写');
      pushCandidate(candidates, {
        start,
        end: start + size,
        kind: 'word',
        bits,
        label: '常见单词',
        detail: `“${raw}”是一个常见单词${notes.length > 0 ? `（${notes.join('、')}）` : ''}。按 2048 词规模估算为 ${COMMON_WORD_BITS.toFixed(1)} 位，共 ${bits.toFixed(1)} 位。`,
      });
    }
  }
}

function collectKeyboardCandidates(chars: string[], candidates: Candidate[]): void {
  const length = chars.length;
  for (let start = 0; start < length; start += 1) {
    const first = keyboardBase(chars[start]);
    const origin = KEY_POSITIONS.get(first.base);
    if (!origin) continue;

    for (const direction of [-1, 1]) {
      let pos = origin.pos;
      let shifted = first.shifted ? 1 : 0;
      for (let index = start + 1; index < length; index += 1) {
        const next = keyboardBase(chars[index]);
        const info = KEY_POSITIONS.get(next.base);
        if (!info || info.row !== origin.row || info.pos !== pos + direction) break;
        pos = info.pos;
        if (next.shifted) shifted += 1;
        const size = index - start + 1;
        if (size < MIN_KEYBOARD_RUN) continue;
        const text = chars.slice(start, index + 1).join('');
        const bits = KEYBOARD_BITS + shifted;
        pushCandidate(candidates, {
          start,
          end: index + 1,
          kind: 'keyboard',
          bits,
          label: `${rowName(origin.row)}键盘序`,
          detail: `“${text}”是键盘上相邻按键的连续走位${shifted > 0 ? `（含 ${shifted} 个上档字符）` : ''}，只有 ${bits.toFixed(1)} 位。`,
        });
      }
    }
  }
}

function rowName(rowIndex: number): string {
  if (rowIndex === 0) return '数字行';
  if (rowIndex === 1) return '字母上排';
  if (rowIndex === 2) return '字母中排';
  return '字母下排';
}

function collectSequenceCandidates(chars: string[], candidates: Candidate[]): void {
  const length = chars.length;
  for (let start = 0; start < length; start += 1) {
    for (const alphabet of SEQUENCE_ALPHABETS) {
      const firstBase = chars[start].toLowerCase();
      const origin = alphabet.indexOf(firstBase);
      if (origin < 0) continue;

      for (const direction of [-1, 1]) {
        let index = origin;
        let shifts = chars[start] !== firstBase ? 1 : 0;
        for (let cursor = start + 1; cursor < length; cursor += 1) {
          const base = chars[cursor].toLowerCase();
          if (base !== chars[cursor]) shifts += 1;
          if (alphabet.indexOf(base) !== index + direction) break;
          index += direction;
          const size = cursor - start + 1;
          if (size < MIN_SEQUENCE_RUN) continue;
          const text = chars.slice(start, cursor + 1).join('');
          const bits = SEQUENCE_BITS + shifts;
          pushCandidate(candidates, {
            start,
            end: cursor + 1,
            kind: 'sequence',
            bits,
            label: alphabet.length === 10 ? '数字序列' : '字母序列',
            detail: `“${text}”是${direction > 0 ? '递增' : '递减'}的连续${alphabet.length === 10 ? '数字' : '字母'}序列，只有 ${bits.toFixed(1)} 位。`,
          });
        }
      }
    }
  }
}

function collectDateCandidates(chars: string[], candidates: Candidate[]): void {
  const length = chars.length;

  for (let start = 0; start < length; start += 1) {
    if (start + 4 <= length && countDigits(chars, start, 4)) {
      const text = chars.slice(start, start + 4).join('');
      const year = Number(text);
      if (year >= YEAR_MIN && year <= YEAR_MAX) {
        pushCandidate(candidates, {
          start,
          end: start + 4,
          kind: 'year',
          bits: Math.log2(YEAR_POOL),
          label: '年份',
          detail: `“${text}”是 ${YEAR_MIN}–${YEAR_MAX} 之间的年份，只有 ${YEAR_POOL} 种可能，约 ${Math.log2(YEAR_POOL).toFixed(1)} 位。`,
        });
      }
    }

    for (const size of [6, 8]) {
      if (start + size > length || !countDigits(chars, start, size)) continue;
      const text = chars.slice(start, start + size).join('');
      const guesses = parseCompactDate(text);
      if (guesses.length === 0) continue;
      const bits = Math.log2(DATE_POOL) + Math.log2(guesses.length);
      const first = guesses[0];
      pushCandidate(candidates, {
        start,
        end: start + size,
        kind: 'date',
        bits,
        label: '日期',
        detail: `“${text}”可以读成 ${first.year} 年 ${first.month} 月 ${first.day} 日这类日期。${YEAR_MIN}–${YEAR_MAX} 的日期总共只有约 ${DATE_POOL} 种，约 ${bits.toFixed(1)} 位。`,
      });
    }
  }
}

function collectSeparatedDateCandidates(password: string, chars: string[], candidates: Candidate[]): void {
  const pattern = /(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/g;
  const offsets: number[] = [];
  let codePointIndex = 0;
  for (const char of password) {
    offsets.push(codePointIndex);
    codePointIndex += char.length;
  }

  for (const match of password.matchAll(pattern)) {
    const index = match.index ?? 0;
    const start = offsets.indexOf(index);
    if (start < 0) continue;
    const text = chars.slice(start, start + match[0].length).join('');

    const readings: Array<[number, number, number]> = [
      [Number(match[1]), Number(match[2]), Number(match[3])],
      [Number(match[3]), Number(match[2]), Number(match[1])],
      [Number(match[3]), Number(match[1]), Number(match[2])],
    ];
    const valid = readings.filter(([year, month, day]) =>
      validDate(expandYear(year), month, day),
    );
    if (valid.length === 0) continue;

    const bits = Math.log2(DATE_POOL) + Math.log2(valid.length) + 1;
    pushCandidate(candidates, {
      start,
      end: start + match[0].length,
      kind: 'date',
      bits,
      label: '带分隔符的日期',
      detail: `“${text}”是带分隔符的日期写法，分隔符只有几种选择，总共约 ${bits.toFixed(1)} 位。`,
    });
  }
}

function collectRepeatCandidates(
  chars: string[],
  context: MatchContext,
  candidates: Candidate[],
): void {
  const length = chars.length;
  for (let start = 0; start < length; start += 1) {
    const maxUnit = Math.min(MAX_REPEAT_UNIT, length - start);
    for (let unit = 1; unit <= maxUnit; unit += 1) {
      if (unit * 2 > MAX_REPEAT_SPAN) break;
      let repeats = 1;
      while (
        repeats < MAX_REPEAT_COUNT &&
        start + unit * (repeats + 1) <= length
      ) {
        let same = true;
        for (let offset = 0; offset < unit; offset += 1) {
          if (chars[start + offset] !== chars[start + unit * repeats + offset]) {
            same = false;
            break;
          }
        }
        if (!same) break;
        repeats += 1;
      }
      if (repeats < 2) continue;

      const unitText = chars.slice(start, start + unit).join('');
      const unitBits = costOfText(unitText, context);
      for (let count = 2; count <= repeats; count += 1) {
        const bits = unitBits + Math.log2(count) + 1;
        const text = chars.slice(start, start + unit * count).join('');
        pushCandidate(candidates, {
          start,
          end: start + unit * count,
          kind: 'repeat',
          bits,
          label: '重复片段',
          detail: `“${text}”是“${unitText}”重复 ${count} 次，重复次数几乎不增加强度，共 ${bits.toFixed(1)} 位。`,
        });
      }
    }
  }
}

function collectContextCandidates(
  chars: string[],
  context: MatchContext,
  candidates: Candidate[],
): void {
  for (const entry of context.contextWords) {
    for (const [needle, reversedHit] of [
      [entry.folded, false],
      [[...entry.folded].reverse(), true],
    ] as Array<[string[], boolean]>) {
      if (reversedHit && needle.join('') === entry.folded.join('')) continue;
      for (let start = 0; start + needle.length <= chars.length; start += 1) {
        let hit = true;
        for (let offset = 0; offset < needle.length; offset += 1) {
          if (foldLeet(chars[start + offset]).toLowerCase() !== needle[offset]) {
            hit = false;
            break;
          }
        }
        if (!hit) continue;

        const text = chars.slice(start, start + needle.length).join('');
        const variation = variationBits(text, needle.join(''));
        const bits = Math.log2(entry.rank) + variation.bits + (reversedHit ? 1 : 0);
        pushCandidate(candidates, {
          start,
          end: start + needle.length,
          kind: 'context',
          bits,
          label: '上下文词',
          detail: `“${text}”与你提供的上下文“${entry.word}”相同或相近（${variation.notes.join('、') || '原样出现'}），攻击者已知这类词，只值 ${bits.toFixed(1)} 位。`,
        });
      }
    }
  }
}

function collectCandidates(
  chars: string[],
  context: MatchContext,
  password: string,
): Candidate[] {
  const candidates: Candidate[] = [];
  collectWeakListCandidates(chars, candidates);
  collectWordCandidates(chars, candidates);
  collectKeyboardCandidates(chars, candidates);
  collectSequenceCandidates(chars, candidates);
  collectDateCandidates(chars, candidates);
  // Separated dates need the original string, because the separators themselves
  // are not part of the digit-run scan.
  collectSeparatedDateCandidates(password, chars, candidates);
  collectRepeatCandidates(chars, context, candidates);
  collectContextCandidates(chars, context, candidates);
  return candidates;
}

interface Cover {
  bits: number;
  segments: Segment[];
}

/** Cheapest cover of a fragment; used to price the unit of a repeat. */
function costOfText(text: string, context: MatchContext): number {
  const cached = context.memo.get(text);
  if (cached !== undefined) return cached;
  const cover = cheapestCover([...text], context, text);
  context.memo.set(text, cover.bits);
  return cover.bits;
}

/**
 * Dynamic program over the candidates.
 *
 * `best[i]` is the cheapest cover of the first `i` characters. Every position
 * can always be covered by brute force at log2(pool) bits, so the table is
 * always reachable and the result can never exceed the charset estimate.
 */
function cheapestCover(chars: string[], context: MatchContext, password: string): Cover {
  const length = chars.length;
  if (length === 0) return { bits: 0, segments: [] };

  const bruteBits = Math.log2(context.pool);
  const candidates = collectCandidates(chars, context, password);
  const byStart = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    const bucket = byStart.get(candidate.start);
    if (bucket) bucket.push(candidate);
    else byStart.set(candidate.start, [candidate]);
  }

  const best = new Array<number>(length + 1).fill(Number.POSITIVE_INFINITY);
  const back: Array<Candidate | null> = new Array<Candidate | null>(length + 1).fill(null);
  best[0] = 0;

  for (let index = 0; index < length; index += 1) {
    if (!Number.isFinite(best[index])) continue;

    const single = best[index] + bruteBits;
    if (single < best[index + 1]) {
      best[index + 1] = single;
      back[index + 1] = null;
    }

    for (const candidate of byStart.get(index) ?? []) {
      const total = best[index] + candidate.bits;
      if (total < best[candidate.end]) {
        best[candidate.end] = total;
        back[candidate.end] = candidate;
      }
    }
  }

  const segments: Segment[] = [];
  let cursor = length;
  while (cursor > 0) {
    const candidate = back[cursor];
    if (candidate) {
      const text = chars.slice(candidate.start, candidate.end).join('');
      segments.push({
        kind: candidate.kind,
        start: candidate.start,
        length: candidate.end - candidate.start,
        text,
        bits: candidate.bits,
        label: candidate.label,
        detail: candidate.detail,
      });
      cursor = candidate.start;
    } else {
      const start = cursor - 1;
      const text = chars[start];
      segments.push({
        kind: 'brute-force',
        start,
        length: 1,
        text,
        bits: bruteBits,
        label: '穷举',
        detail: `“${text}”没有匹配到已知模式，按字符集 ${context.pool} 个字符的穷举计，每位约 ${bruteBits.toFixed(1)} 位。`,
      });
      cursor = start;
    }
  }

  segments.reverse();

  // Merge adjacent brute-force characters: one row per character with the same
  // detail repeated is noise, and the whole run has the same per-character cost.
  const merged: Segment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (segment.kind === 'brute-force' && previous?.kind === 'brute-force') {
      previous.length += segment.length;
      previous.text += segment.text;
      previous.bits += segment.bits;
      previous.detail = `这 ${previous.length} 个字符没有匹配到已知模式，按字符集 ${context.pool} 个字符穷举，共 ${previous.bits.toFixed(1)} 位。`;
      continue;
    }
    merged.push({ ...segment });
  }

  return { bits: best[length], segments: merged };
}

/** Groups findings by pattern kind so three dictionary hits are one row. */
function buildFindings(
  composition: Composition,
  charsetBits: number,
  effectiveBits: number,
  segments: Segment[],
  contextWordCount: number,
): Finding[] {
  const findings: Finding[] = [];

  for (const kind of ['weak-list', 'context', 'keyboard', 'sequence', 'word', 'repeat', 'date', 'year'] as PatternKind[]) {
    const matches = segments.filter((segment) => segment.kind === kind);
    if (matches.length === 0) continue;

    const severity: Finding['severity'] =
      kind === 'weak-list' || kind === 'context' || kind === 'keyboard' || kind === 'sequence'
        ? 'high'
        : kind === 'word' || kind === 'repeat'
          ? 'medium'
          : 'low';

    findings.push({
      id: `pattern-${kind}`,
      severity,
      title: `${PATTERN_KIND_LABELS[kind]}：${matches.map((match) => `“${match.text}”`).join('、')}`,
      detail: matches.map((match) => match.detail).join(' '),
    });
  }

  if (composition.classes.length <= 1 && composition.poolSize > 0) {
    findings.push({
      id: 'single-class',
      severity: 'medium',
      title: `只用了${CHAR_CLASS_LABELS[composition.classes[0]]}一种字符`,
      detail: `即使每个字符都完全随机，10 位纯数字也只有 ${charsetEntropyBits(10, 10).toFixed(1)} 位熵，远低于建议的 80 位。“必须加符号”不是重点，长度和随机性才是。`,
    });
  }

  if (charsetBits - effectiveBits >= 15) {
    findings.push({
      id: 'charset-overestimate',
      severity: 'info',
      title: '按字符集估算会高估这个密码',
      detail: `字符集公式给出 ${charsetBits.toFixed(1)} 位，按模式分解只有 ${effectiveBits.toFixed(1)} 位。该公式假设密码是从字符集里均匀随机抽出来的，而人不会那样选密码，所以两者差得越多，说明这个密码越“看起来复杂”。`,
    });
  }

  if (composition.counts.other > 0) {
    findings.push({
      id: 'unicode',
      severity: 'info',
      title: '包含非 ASCII 字符',
      detail: `估算里每个非 ASCII 字符按其所属 Unicode 区块的大小计算。但不同系统对 Unicode 的规范化（NFC 与 NFD）和编码方式并不一致，同一个密码在不同站点可能被存成不同的字节，实际搜索空间通常小于这里的估计。`,
    });
  }

  if (contextWordCount > 0) {
    findings.push({
      id: 'context-provided',
      severity: 'info',
      title: `已用 ${contextWordCount} 个上下文词检查`,
      detail: '上下文词被当作攻击者已知的信息（网站名、用户名等本来就公开），命中它们的片段几乎不贡献熵。',
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: 'no-pattern',
      severity: 'info',
      title: '没有识别出明显弱模式',
      detail: '这不等于绝对安全：没有模式只说明本工具的模式库和词表里没有匹配项，重复使用、被钓鱼、站点明文存储等风险都不在这个数字里。',
    });
  }

  return findings;
}

/** Quantified improvement options, ordered by bits gained. */
function buildSuggestions(
  composition: Composition,
  effectiveBits: number,
  segments: Segment[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const pool = composition.poolSize;
  const length = composition.classes.reduce(
    (total, key) => total + composition.counts[key],
    0,
  );

  if (length > 0 && pool > 1) {
    const perChar = Math.log2(pool);
    const target = Math.max(16, length + 4);
    const extra = target - length;
    const gain = extra * perChar;
    const symbolGain = composition.counts.symbols === 0
      ? length * (Math.log2(pool + SYMBOL_POOL) - perChar)
      : 0;

    const comparison = symbolGain > 0
      ? `作为对比，长度不变、只把符号加进字符集，字符集从 ${pool} 扩到 ${pool + SYMBOL_POOL}，同样这 ${length} 位只增加 ${symbolGain.toFixed(1)} 位。两者差 ${(gain / symbolGain).toFixed(1)} 倍。`
      : `当前已经用了符号；继续加字符类型的边际收益同样是每位 ${perChar.toFixed(2)} 位的字符集扩张，远小于加长。`;

    suggestions.push({
      id: 'length',
      title: `加长到 ${target} 位`,
      detail: `每多一位按 log2(${pool}) = ${perChar.toFixed(2)} 位计，加 ${extra} 位共 +${gain.toFixed(1)} 位。${comparison}`,
      gainBits: gain,
      recommended: false,
    });
  }

  if (composition.counts.symbols === 0 && length > 0 && pool > 1) {
    const gain = length * (Math.log2(pool + SYMBOL_POOL) - Math.log2(pool));
    suggestions.push({
      id: 'symbols',
      title: '加入符号',
      detail: `长度不变（${length} 位），把字符集从 ${pool} 扩到 ${pool + SYMBOL_POOL}，共 +${gain.toFixed(1)} 位。同一个字符集里多一位字符的收益是 ${Math.log2(pool).toFixed(2)} 位，所以加符号只有在长度已经够长时才值得做。`,
      gainBits: gain,
      recommended: false,
    });
  }

  const patterned = segments.filter((segment) => segment.kind !== 'brute-force');
  if (patterned.length > 0) {
    const patternBits = patterned.reduce((total, segment) => total + segment.bits, 0);
    const texts = patterned.map((segment) => `“${segment.text}”`).join('、');
    suggestions.push({
      id: 'remove-patterns',
      title: '换掉可预测的片段',
      detail: `${texts} 合计只贡献 ${patternBits.toFixed(1)} 位，而这些字符占了 ${patterned.reduce((total, segment) => total + segment.length, 0)} 位长度。换成随机字符后，同样的长度会按每位 ${Math.log2(pool).toFixed(2)} 位计算。`,
      gainBits: Math.max(patterned.reduce((total, segment) => total + segment.length, 0) * Math.log2(pool) - patternBits, 0),
      recommended: false,
    });
  }

  if (effectiveBits < 44) {
    suggestions.push({
      id: 'passphrase',
      title: '改用 4 个随机单词的短语',
      detail: `4 个词取自 2048 词的公开词表是 4 × ${COMMON_WORD_BITS.toFixed(1)} = 44 位，也更好记。XKCD #936 用这个例子说明：长度带来的熵比“看起来复杂”更值钱。`,
      gainBits: 44 - effectiveBits,
      recommended: false,
    });
  }

  suggestions.push({
    id: 'reuse',
    title: '每个站点用不同的密码，并交给密码管理器',
    detail: '同一个密码重复使用，等于把最弱那个站点的安全性复制给所有账号；被拖库的站点往往比你想象的普通。这一条不增加熵的数字，但它比任何字符替换都更能决定实际后果。',
    gainBits: 0,
    recommended: false,
  });

  const sorted = [...suggestions].sort((a, b) => b.gainBits - a.gainBits);
  if (sorted.length > 0 && sorted[0].gainBits > 0) sorted[0].recommended = true;
  return sorted;
}

export interface AnalyseOptions {
  /**
   * Words an attacker could know: site name, user name, e-mail local part. They
   * are treated as a known word list of the given order.
   */
  contextWords?: readonly string[];
}

/** Analyses a password. Pure: same input, same output, no side effects. */
export function analysePassword(
  password: string,
  options: AnalyseOptions = {},
): PasswordAnalysis {
  const chars = [...password];
  const composition = describeComposition(password);
  const length = chars.length;

  const contextWords: ContextWord[] = [];
  const seen = new Set<string>();
  for (const raw of options.contextWords ?? []) {
    const word = raw.trim();
    if (word.length < 3) continue;
    const folded = foldLeet(word);
    if (!/^[a-z0-9]+$/.test(folded)) continue;
    if (seen.has(folded)) continue;
    seen.add(folded);
    contextWords.push({ word, folded: [...folded], rank: contextWords.length + 1 });
  }

  const empty = length === 0 || composition.poolSize <= 1;
  const charsetBits = charsetEntropyBits(length, composition.poolSize);
  const context: MatchContext = {
    pool: Math.max(composition.poolSize, 2),
    contextWords,
    memo: new Map(),
  };

  const cover: Cover = empty
    ? { bits: 0, segments: [] }
    : cheapestCover(chars, context, password);
  const effectiveBits = Math.min(charsetBits, cover.bits);

  const segmentKindAt = new Map<number, Segment>();
  for (const segment of cover.segments) {
    for (let offset = 0; offset < segment.length; offset += 1) {
      segmentKindAt.set(segment.start + offset, segment);
    }
  }

  const breakdown: CharRow[] = chars.map((char, index) => {
    const codePoint = char.codePointAt(0) ?? 0;
    const charClass = classifyCodePoint(codePoint);
    const segment = segmentKindAt.get(index);
    return {
      index: index + 1,
      char,
      codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
      className: charClass,
      classLabel: CHAR_CLASS_LABELS[charClass],
      segmentKind: segment?.kind ?? 'brute-force',
      segmentLabel: PATTERN_KIND_LABELS[segment?.kind ?? 'brute-force'],
    };
  });

  return {
    empty,
    length,
    utf16Length: password.length,
    composition,
    charsetBits,
    patternBits: cover.bits,
    effectiveBits,
    log2Guesses: Math.max(effectiveBits - 1, 0),
    segments: cover.segments,
    findings: empty
      ? [
          {
            id: 'empty',
            severity: 'info',
            title: '还没有输入',
            detail: '在输入框里键入密码即可分析。密码只留在当前页面的内存里，不会上传、不会写入本地存储、也不会出现在地址栏里。',
          },
        ]
      : buildFindings(composition, charsetBits, effectiveBits, cover.segments, contextWords.length),
    crackTimes: estimateCrackTimes(effectiveBits),
    suggestions: empty ? [] : buildSuggestions(composition, effectiveBits, cover.segments),
    verdict: empty
      ? { label: '—', tone: 'warning', summary: '等待输入。' }
      : verdictFor(effectiveBits),
    breakdown,
  };
}
