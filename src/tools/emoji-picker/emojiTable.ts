/**
 * The curated emoji table.
 *
 * ## Why this is a curated subset, not the full Unicode set
 *
 * Unicode defines well over 3,600 emoji, and the sequence space (skin tones,
 * gender variants, flags, keycaps, ZWJ combinations) is far larger again. That
 * is several hundred kilobytes of data and a search problem nobody wants in a
 * picker: the whole set is worse to browse than a few hundred well-chosen
 * entries. This table therefore carries the emoji people actually reach for,
 * and the UI says plainly that it is a subset.
 *
 * ## Format
 *
 * One emoji per line, three `|`-separated fields:
 *
 *     <emoji>|<中文名>|<english keywords>
 *
 * A line format rather than a nested object literal because the emoji itself
 * has to be readable in the source: an escaped form such as \u{1F600} is
 * unreviewable, and a mistyped escape is invisible in a diff. The Chinese name
 * is what the picker displays; the English keywords make search work in both
 * languages. `parseEmojiTable()` in `emojiPickerUtils.ts` rejects a malformed
 * line loudly at module load rather than dropping it silently.
 *
 * Skin-tone modifiers (U+1F3FB-U+1F3FF) and gender variants are deliberately
 * absent — the tool says so — because each base emoji would otherwise need five
 * near-identical rows. ZWJ sequences such as the family emoji are included,
 * because they are the clearest demonstration of why one visible character can
 * be five code points long.
 */

/** The eight groups shown in the picker, in display order. */
export const EMOJI_CATEGORY_IDS = [
  'smileys',
  'people',
  'animals',
  'food',
  'activities',
  'travel',
  'objects',
  'symbols',
] as const;

export type EmojiCategoryId = (typeof EMOJI_CATEGORY_IDS)[number];

/** Chinese labels for {@link EMOJI_CATEGORY_IDS}, in the same order. */
export const EMOJI_CATEGORY_LABELS: Record<EmojiCategoryId, string> = {
  smileys: '笑脸',
  people: '人物',
  animals: '动物',
  food: '食物',
  activities: '活动',
  travel: '旅行',
  objects: '物件',
  symbols: '符号',
};

/** Raw rows per category, parsed by `parseEmojiTable()`. */
export const EMOJI_TABLE: Record<EmojiCategoryId, string> = {
  smileys: `
😀|咧嘴笑|grinning face smile
😃|大笑|grinning face with big eyes happy
😄|眯眼大笑|grinning squinting face happy
😁|露齿笑|beaming face with smiling eyes grin
😆|眯眼咧嘴笑|laughing squinting face
😅|苦笑流汗|grinning face with sweat relief
🤣|笑翻|rolling on the floor laughing rofl
😂|笑哭|face with tears of joy cry laugh
🙂|微笑|slightly smiling face
🙃|倒脸|upside down face silly
🫠|融化脸|melting face
😉|眨眼|winking face wink
😊|害羞笑|smiling face with smiling eyes blush
😇|天使|smiling face with halo angel
🥰|爱心脸|smiling face with hearts adore
😍|花痴|smiling face with heart eyes love
🤩|星星眼|star struck amazed wow
😘|飞吻|face blowing a kiss
😋|好吃|face savoring food yummy
😛|吐舌|face with tongue
😜|眨眼吐舌|winking face with tongue
🤪|疯狂脸|zany face crazy
😝|眯眼吐舌|squinting face with tongue
🤑|见钱眼开|money mouth face rich
🤗|拥抱|smiling face with open hands hug
🤭|捂嘴笑|face with hand over mouth giggle
🫢|惊讶捂嘴|face with open eyes and hand over mouth gasp
🫣|偷看|face with peeking eye
🤫|嘘|shushing face quiet
🤔|思考|thinking face hmm
🫡|敬礼|saluting face
🤐|闭嘴|zipper mouth face secret
🤨|挑眉|face with raised eyebrow suspicious
😐|面无表情|neutral face
😑|无语|expressionless face
😶|无嘴脸|face without mouth silent
😏|坏笑|smirking face smirk
😒|不爽|unamused face
🙄|翻白眼|face with rolling eyes
😬|龇牙|grimacing face awkward
😮‍💨|叹气|face exhaling sigh relief
😌|放松|relieved face calm
😔|失落|pensive face sad
😴|睡觉|sleeping face zzz
😷|戴口罩|face with medical mask sick
🤒|发烧|face with thermometer sick
🤕|受伤|face with head bandage hurt
🤢|恶心|nauseated face sick
🤮|呕吐|face vomiting sick
🤧|打喷嚏|sneezing face sick
🥵|热|hot face heat
🥶|冷|cold face freezing
🥴|晕乎乎|woozy face drunk
😵|眼冒金星|face with crossed out eyes dizzy
🤯|爆炸头|exploding head mind blown
🤠|牛仔|cowboy hat face
🥳|派对脸|partying face celebrate
🥸|伪装|disguised face
😎|戴墨镜的笑脸|smiling face with sunglasses cool
🤓|书呆子|nerd face glasses
🧐|单片眼镜|face with monocle
😕|困惑|confused face
😟|担忧|worried face
😮|惊讶|face with open mouth surprise
😲|震惊|astonished face
😳|脸红|flushed face embarrassed
🥺|委屈|pleading face puppy eyes
😢|哭|crying face sad
😭|大哭|loudly crying face sob
😱|尖叫|face screaming in fear
😩|疲惫|weary face
😫|累|tired face
🥱|打哈欠|yawning face bored
😤|哼|face with steam from nose
😡|生气|pouting face angry
😠|愤怒|angry face
🤬|骂人|face with symbols on mouth swear
😈|恶魔笑|smiling face with horns devil
👿|生气的恶魔|angry face with horns
💀|骷髅|skull dead
☠️|骷髅交叉骨|skull and crossbones danger
💩|大便|pile of poo
🤡|小丑|clown face
👻|幽灵|ghost
👽|外星人|alien
👾|外星怪物|alien monster
🤖|机器人|robot
😺|猫笑脸|grinning cat
😹|猫笑哭|cat with tears of joy
😻|猫花痴|smiling cat with heart eyes
😼|猫坏笑|cat with wry smile
🙀|猫惊讶|weary cat
🙈|非礼勿视|see no evil monkey
🙉|非礼勿听|hear no evil monkey
🙊|非礼勿言|speak no evil monkey
`,
  people: `
👋|挥手|waving hand hello hi bye
🤚|手背|raised back of hand
✋|举手|raised hand stop
🖖|瓦肯礼|vulcan salute spock
👌|没问题|ok hand okay
🤌|捏手|pinched fingers italian
🤏|一点点|pinching hand small
✌️|胜利手势|victory hand peace
🤞|交叉手指|crossed fingers luck
🫰|比心|hand with index finger and thumb crossed
🤟|爱你手势|love you gesture
🤘|摇滚|sign of the horns rock
🤙|打电话|call me hand
👈|指向左|backhand index pointing left
👉|指向右|backhand index pointing right
👆|指向上|backhand index pointing up
👇|指向下|backhand index pointing down
☝️|食指向上|index pointing up
👍|赞|thumbs up like good
👎|踩|thumbs down dislike bad
✊|举拳|raised fist
👊|碰拳|oncoming fist punch
🤛|左拳|left facing fist
🤜|右拳|right facing fist
👏|鼓掌|clapping hands applause
🙌|举手欢呼|raising hands hooray
🫶|爱心手|heart hands love
👐|张开双手|open hands
🤲|双手捧|palms up together
🤝|握手|handshake deal
🙏|祈祷|folded hands please thanks pray
✍️|写字|writing hand
💅|美甲|nail polish
🤳|自拍|selfie
💪|肌肉|flexed biceps strong
🦾|机械臂|mechanical arm
🦵|腿|leg
🦶|脚|foot
👂|耳朵|ear hear
👃|鼻子|nose smell
👀|眼睛|eyes look see
👁️|单眼|eye
👅|舌头|tongue taste
👄|嘴|mouth lips
🫦|咬唇|biting lip
🧠|大脑|brain
🫀|心脏器官|anatomical heart
🦷|牙齿|tooth
🦴|骨头|bone
👶|婴儿|baby
🧒|儿童|child
👦|男孩|boy
👧|女孩|girl
🧑|成人|person adult
👨|男人|man
👩|女人|woman
🧓|老人|older person
👴|老爷爷|old man
👵|老奶奶|old woman
👮|警察|police officer cop
🕵️|侦探|detective spy
💂|卫兵|guard
👷|建筑工人|construction worker
🤴|王子|prince
👸|公主|princess
👳|戴头巾的人|person with turban
🧕|戴头巾的女性|woman with headscarf
🤵|穿燕尾服的人|person in tuxedo
👰|戴头纱的人|person with veil
🤰|孕妇|pregnant woman
🤱|哺乳|breast feeding
👼|天使宝宝|baby angel
🎅|圣诞老人|santa claus
🤶|圣诞奶奶|mrs claus
🦸|超级英雄|superhero
🦹|超级反派|super villain
🧙|法师|mage wizard
🧚|小仙子|fairy
🧛|吸血鬼|vampire
🧜|美人鱼|merperson
🧝|精灵|elf
🧞|灯神|genie
🧟|僵尸|zombie
💆|按摩|face massage
💇|理发|haircut
🚶|走路|person walking
🏃|跑步|person running
💃|跳舞的女人|woman dancing
🕺|跳舞的男人|man dancing
👯|兔女郎|people with bunny ears
🧘|打坐|person in lotus position yoga
👫|手拉手的一男一女|woman and man holding hands
👬|手拉手的两个男人|two men holding hands
👭|手拉手的两个女人|two women holding hands
👨‍👩‍👧|一家三口|family man woman girl
👨‍👩‍👧‍👦|一家四口|family man woman girl boy
👨‍👨‍👦|两个爸爸和孩子|family man man boy
👩‍👩‍👧|两个妈妈和孩子|family woman woman girl
🧑‍🤝‍🧑|牵手的人|people holding hands
`,
  animals: `
🐶|狗脸|dog face puppy
🐱|猫脸|cat face kitten
🐭|老鼠脸|mouse face
🐹|仓鼠|hamster
🐰|兔子脸|rabbit face bunny
🦊|狐狸|fox
🐻|熊|bear
🐼|熊猫|panda
🐨|考拉|koala
🐯|老虎脸|tiger face
🦁|狮子|lion
🐮|牛脸|cow face
🐷|猪脸|pig face
🐸|青蛙|frog
🐵|猴子脸|monkey face
🐔|鸡|chicken
🐧|企鹅|penguin
🐦|鸟|bird
🐤|小鸡|baby chick
🦆|鸭子|duck
🦅|老鹰|eagle
🦉|猫头鹰|owl
🦇|蝙蝠|bat
🐺|狼|wolf
🐗|野猪|boar
🐴|马脸|horse face
🦄|独角兽|unicorn
🐝|蜜蜂|honeybee bee
🐛|毛毛虫|bug caterpillar
🦋|蝴蝶|butterfly
🐌|蜗牛|snail
🐞|瓢虫|lady beetle
🐜|蚂蚁|ant
🕷️|蜘蛛|spider
🦂|蝎子|scorpion
🐢|乌龟|turtle
🐍|蛇|snake
🦎|蜥蜴|lizard
🦖|霸王龙|t rex dinosaur
🦕|长颈龙|sauropod dinosaur
🐙|章鱼|octopus
🦑|鱿鱼|squid
🦐|虾|shrimp
🦞|龙虾|lobster
🦀|螃蟹|crab
🐡|河豚|blowfish
🐠|热带鱼|tropical fish
🐟|鱼|fish
🐬|海豚|dolphin
🐳|喷水鲸|spouting whale
🦈|鲨鱼|shark
🐊|鳄鱼|crocodile
🐅|老虎|tiger
🐆|豹|leopard
🦓|斑马|zebra
🦍|大猩猩|gorilla
🐘|大象|elephant
🦛|河马|hippopotamus
🦏|犀牛|rhinoceros
🐪|单峰骆驼|camel
🦒|长颈鹿|giraffe
🦘|袋鼠|kangaroo
🐄|奶牛|cow
🐖|猪|pig
🐑|绵羊|ewe sheep
🐐|山羊|goat
🦌|鹿|deer
🐕|狗|dog
🐈|猫|cat
🐓|公鸡|rooster
🦃|火鸡|turkey
🦚|孔雀|peacock
🦜|鹦鹉|parrot
🕊️|和平鸽|dove peace
🐇|兔子|rabbit
🦔|刺猬|hedgehog
🐁|小鼠|mouse
🐿️|松鼠|chipmunk squirrel
`,
  food: `
🍎|红苹果|red apple
🍐|梨|pear
🍊|橘子|tangerine orange
🍋|柠檬|lemon
🍌|香蕉|banana
🍉|西瓜|watermelon
🍇|葡萄|grapes
🍓|草莓|strawberry
🫐|蓝莓|blueberries
🍒|樱桃|cherries
🍑|桃子|peach
🥭|芒果|mango
🍍|菠萝|pineapple
🥥|椰子|coconut
🥝|猕猴桃|kiwi fruit
🍅|西红柿|tomato
🍆|茄子|eggplant
🥑|牛油果|avocado
🥦|西兰花|broccoli
🥬|绿叶菜|leafy green
🥒|黄瓜|cucumber
🌶️|辣椒|hot pepper
🌽|玉米|ear of corn
🥕|胡萝卜|carrot
🧄|大蒜|garlic
🧅|洋葱|onion
🥔|土豆|potato
🍠|红薯|roasted sweet potato
🥐|牛角包|croissant
🍞|面包|bread
🥖|法棍|baguette
🥨|椒盐卷饼|pretzel
🧀|奶酪|cheese
🥚|鸡蛋|egg
🍳|煎蛋|cooking fried egg
🧈|黄油|butter
🥞|松饼|pancakes
🧇|华夫饼|waffle
🥓|培根|bacon
🍔|汉堡|hamburger
🍟|薯条|french fries
🍕|披萨|pizza
🌭|热狗|hot dog
🥪|三明治|sandwich
🌮|墨西哥卷饼|taco
🌯|卷饼|burrito
🥙|皮塔饼|stuffed flatbread
🍜|拉面|steaming bowl ramen noodles
🍲|炖菜|pot of food
🍛|咖喱饭|curry rice
🍣|寿司|sushi
🍱|便当|bento box
🥟|饺子|dumpling
🍤|炸虾|fried shrimp
🍙|饭团|rice ball
🍚|米饭|cooked rice
🍢|关东煮|oden
🍡|团子|dango
🍦|冰淇淋|soft ice cream
🍰|蛋糕|shortcake cake
🎂|生日蛋糕|birthday cake
🍮|布丁|custard pudding
🍭|棒棒糖|lollipop
🍬|糖果|candy
🍫|巧克力|chocolate bar
🍿|爆米花|popcorn
🍩|甜甜圈|doughnut donut
🍪|饼干|cookie
☕|咖啡|hot beverage coffee
🍵|茶|teacup without handle tea
🧋|奶茶|bubble tea boba
🥤|饮料杯|cup with straw
🧃|果汁盒|beverage box juice
🍺|啤酒|beer mug
🍻|碰杯啤酒|clinking beer mugs cheers
🥂|碰杯|clinking glasses champagne
🍷|红酒|wine glass
🥃|威士忌|tumbler glass whisky
🍸|鸡尾酒|cocktail glass
🍹|热带饮料|tropical drink
🍾|香槟|bottle with popping cork
`,
  activities: `
⚽|足球|soccer ball football
🏀|篮球|basketball
🏈|美式足球|american football
⚾|棒球|baseball
🎾|网球|tennis
🏐|排球|volleyball
🏉|橄榄球|rugby football
🎱|台球|pool 8 ball billiards
🏓|乒乓球|ping pong
🏸|羽毛球|badminton
🏒|冰球|ice hockey
🏏|板球|cricket game
🥅|球门|goal net
⛳|高尔夫|flag in hole golf
🏹|射箭|bow and arrow archery
🎣|钓鱼|fishing pole
🤿|潜水|diving mask
🥊|拳击|boxing glove
🥋|道服|martial arts uniform
🎽|运动背心|running shirt
🛹|滑板|skateboard
🛼|轮滑|roller skate
🛷|雪橇|sled
⛸️|溜冰鞋|ice skate
🎿|滑雪|skis
🏂|单板滑雪|snowboarder
🏋️|举重|person lifting weights gym
🤸|侧手翻|person cartwheeling
🏄|冲浪|person surfing
🏊|游泳|person swimming
🚴|骑车|person biking
🧗|攀岩|person climbing
🎪|马戏团|circus tent
🎭|戏剧|performing arts theater
🎨|调色板|artist palette paint
🎬|场记板|clapper board movie
🎤|麦克风|microphone sing
🎧|耳机|headphone music
🎼|乐谱|musical score
🎹|钢琴|musical keyboard piano
🥁|鼓|drum
🎷|萨克斯|saxophone
🎺|小号|trumpet
🎸|吉他|guitar
🎻|小提琴|violin
🎲|骰子|game die dice
♟️|棋子|chess pawn
🎯|靶心|direct hit target bullseye
🎳|保龄球|bowling
🎮|游戏手柄|video game controller
🎰|老虎机|slot machine
🧩|拼图|puzzle piece
🏆|奖杯|trophy win
🥇|金牌|first place medal gold
🥈|银牌|second place medal silver
🥉|铜牌|third place medal bronze
🎖️|军功章|military medal
🎗️|丝带|reminder ribbon
🎫|门票|ticket
🎟️|入场券|admission tickets
🎁|礼物|wrapped gift present
🎈|气球|balloon
🎉|派对彩带|party popper celebrate
🎊|彩球|confetti ball
🎀|蝴蝶结|ribbon bow
`,
  travel: `
🌵|仙人掌|cactus
🎄|圣诞树|christmas tree
🌲|松树|evergreen tree
🌳|落叶树|deciduous tree
🌴|棕榈树|palm tree
🌱|幼苗|seedling
🌿|药草|herb
☘️|三叶草|shamrock
🍀|四叶草|four leaf clover luck
🍁|枫叶|maple leaf
🍂|落叶|fallen leaf
🍃|飘叶|leaf fluttering in wind
🌾|稻穗|sheaf of rice
🌷|郁金香|tulip
🌹|玫瑰|rose flower love
🌺|芙蓉|hibiscus
🌸|樱花|cherry blossom
🌼|雏菊|blossom
🌻|向日葵|sunflower
🌞|太阳脸|sun with face
🌝|满月脸|full moon face
🌈|彩虹|rainbow
🚗|汽车|car automobile
🚕|出租车|taxi
🚙|越野车|sport utility vehicle suv
🚌|公交车|bus
🏎️|赛车|racing car
🚓|警车|police car
🚑|救护车|ambulance
🚒|消防车|fire engine
🚚|货车|delivery truck
🚜|拖拉机|tractor
🛻|皮卡|pickup truck
🚲|自行车|bicycle bike
🛴|滑板车|kick scooter
🛵|踏板摩托|motor scooter
🏍️|摩托车|motorcycle
🚨|警灯|police car light siren
⛽|加油站|fuel pump gas
🚦|红绿灯|vertical traffic light
🚧|施工|construction barrier
🚄|高铁|high speed train
🚂|蒸汽火车|locomotive steam train
🚇|地铁|metro subway
🚉|车站|station
✈️|飞机|airplane flight
🛫|起飞|airplane departure takeoff
🛬|降落|airplane arrival landing
🚁|直升机|helicopter
🚀|火箭|rocket launch
🛸|飞碟|flying saucer ufo
⛵|帆船|sailboat
🚤|快艇|speedboat
🛳️|客轮|passenger ship
⚓|锚|anchor
🗺️|地图|world map
🧭|指南针|compass
🗿|摩艾石像|moai statue
🗽|自由女神像|statue of liberty
🗼|东京塔|tokyo tower
🏰|城堡|castle
🏯|日本城堡|japanese castle
🎡|摩天轮|ferris wheel
🎢|过山车|roller coaster
🎠|旋转木马|carousel horse
⛲|喷泉|fountain
⛱️|遮阳伞|umbrella on ground beach
🏖️|海滩|beach with umbrella
🏝️|海岛|desert island
🌋|火山|volcano
⛰️|山|mountain
🏔️|雪山|snow capped mountain
🏕️|露营|camping
⛺|帐篷|tent
🏠|房子|house home
🏢|办公楼|office building
🏥|医院|hospital
🏦|银行|bank
🏨|酒店|hotel
🏫|学校|school
🏭|工厂|factory
⛪|教堂|church
🕌|清真寺|mosque
🛕|印度神庙|hindu temple
⛩️|鸟居|shinto shrine
🌅|日出|sunrise
🌇|城市日落|sunset city
🌃|夜晚城市|night with stars
🌉|夜景桥|bridge at night
🌌|银河|milky way
`,
  objects: `
⌚|手表|watch
📱|手机|mobile phone smartphone
💻|笔记本电脑|laptop computer
⌨️|键盘|keyboard
🖥️|台式机|desktop computer
🖨️|打印机|printer
🖱️|鼠标|computer mouse
💾|软盘|floppy disk save
💿|光盘|optical disk cd
📷|相机|camera photo
📸|开闪光灯拍照|camera with flash
📹|摄像机|video camera
🎥|电影摄影机|movie camera
📞|电话听筒|telephone receiver
☎️|电话|telephone
📠|传真机|fax machine
📺|电视|television tv
📻|收音机|radio
🎙️|录音棚麦克风|studio microphone
⏰|闹钟|alarm clock
⏱️|秒表|stopwatch
⏳|沙漏|hourglass not done
⌛|沙漏流完|hourglass done
🕰️|座钟|mantelpiece clock
🔋|电池|battery
🔌|插头|electric plug
💡|灯泡|light bulb idea
🔦|手电筒|flashlight
🕯️|蜡烛|candle
🧯|灭火器|fire extinguisher
💸|飞走的钱|money with wings
💵|美元|dollar banknote money
💰|钱袋|money bag
💳|信用卡|credit card
🧾|收据|receipt
💎|钻石|gem stone diamond
⚖️|天平|balance scale justice
🔧|扳手|wrench
🔨|锤子|hammer
🛠️|工具|hammer and wrench tools
⛏️|矿镐|pick
🔩|螺丝|nut and bolt
⚙️|齿轮|gear settings
🧲|磁铁|magnet
🔫|水枪|water pistol
💣|炸弹|bomb
🧨|鞭炮|firecracker
🔪|菜刀|kitchen knife
🗡️|匕首|dagger
🛡️|盾牌|shield
🔮|水晶球|crystal ball
🧿|护身符|nazar amulet
⚗️|蒸馏器|alembic
🔭|望远镜|telescope
🔬|显微镜|microscope
💊|药丸|pill
💉|注射器|syringe
🩹|创可贴|adhesive bandage
🩺|听诊器|stethoscope
🌡️|温度计|thermometer
🧴|乳液|lotion bottle
🧹|扫帚|broom
🧺|篮子|basket
🧻|卷纸|roll of paper toilet
🚽|马桶|toilet
🚿|淋浴|shower
🛁|浴缸|bathtub
🧼|肥皂|soap
🪥|牙刷|toothbrush
🗝️|旧钥匙|old key
🔑|钥匙|key
🚪|门|door
🪑|椅子|chair
🛋️|沙发|sofa couch
🛏️|床|bed
🖼️|画框|framed picture
🛍️|购物袋|shopping bags
🎒|书包|backpack school
👓|眼镜|glasses
🕶️|太阳镜|sunglasses
👔|领带|necktie
👕|T恤|t shirt
👖|牛仔裤|jeans
🧦|袜子|socks
👗|连衣裙|dress
👟|运动鞋|running shoe sneaker
👠|高跟鞋|high heeled shoe
👑|王冠|crown king queen
🎩|礼帽|top hat
🧢|棒球帽|billed cap
💄|口红|lipstick
💍|戒指|ring diamond
📦|包裹|package box
📫|信箱|closed mailbox with raised flag
📮|邮筒|postbox
📜|卷轴|scroll
📄|文档|page facing up document
📊|柱状图|bar chart
📈|上升趋势|chart increasing
📉|下降趋势|chart decreasing
📅|日历|calendar date
📌|图钉|pushpin
📍|定位|round pushpin location
📎|回形针|paperclip
📏|直尺|straight ruler
✂️|剪刀|scissors cut
🔒|锁|locked
🔓|开锁|unlocked
🔐|密码锁|locked with key
🔍|放大镜|magnifying glass search
🔎|放大镜向右|magnifying glass tilted right
🕳️|洞|hole
`,
  symbols: `
🏳️‍🌈|彩虹旗|rainbow flag pride lgbt
🏴‍☠️|海盗旗|pirate flag
🏁|格子旗|chequered flag finish
🚩|三角旗|triangular flag
🎌|交叉旗|crossed flags
❤️|红心|red heart love
🧡|橙心|orange heart
💛|黄心|yellow heart
💚|绿心|green heart
💙|蓝心|blue heart
💜|紫心|purple heart
🖤|黑心|black heart
🤍|白心|white heart
🤎|棕心|brown heart
💔|心碎|broken heart
❣️|心形感叹|heart exclamation
💕|两颗心|two hearts
💞|旋转的心|revolving hearts
💓|心跳|beating heart
💗|长大的心|growing heart
💖|闪亮的心|sparkling heart
💘|丘比特之心|heart with arrow
💝|礼物心|heart with ribbon
✨|闪亮|sparkles
⭐|星星|star
🌟|发光星|glowing star
💫|头晕星|dizzy
⚡|闪电|high voltage lightning
🔥|火|fire flame hot
💥|爆炸|collision explosion boom
❄️|雪花|snowflake
🌊|海浪|water wave
🎵|音符|musical note
🎶|多个音符|musical notes
🔔|铃铛|bell
🔕|静音铃|bell with slash mute
📣|扩音器|megaphone
📢|喇叭|loudspeaker announce
💬|对话气泡|speech balloon comment
💭|思考气泡|thought balloon
🗯️|愤怒气泡|right anger bubble
✅|对勾|check mark button done
☑️|勾选框|check box with check
✔️|对勾符号|check mark
❌|叉号|cross mark no
❎|叉号按钮|cross mark button
⭕|圆圈|hollow red circle
❗|感叹号|exclamation mark
‼️|双感叹号|double exclamation mark
❓|问号|question mark
⁉️|感叹问号|exclamation question mark
⚠️|警告|warning
🚫|禁止标志|prohibited no entry
⛔|禁止通行|no entry
📵|禁止用手机|no mobile phones
🚭|禁止吸烟|no smoking
♻️|回收|recycling symbol
🆗|OK 按钮|OK button
🆕|新|new button
🆒|酷|cool button
🆓|免费|free button
🆙|上升|up button
🆘|求救|sos button
🔞|未成年人禁止|no one under eighteen
🔠|大写字母|input latin uppercase
🔡|小写字母|input latin lowercase
🔢|数字输入|input numbers
🔤|字母输入|input latin letters
#️⃣|井号键|keycap hash
*️⃣|星号键|keycap asterisk
0️⃣|数字零|keycap digit zero
1️⃣|数字一|keycap digit one
2️⃣|数字二|keycap digit two
3️⃣|数字三|keycap digit three
4️⃣|数字四|keycap digit four
5️⃣|数字五|keycap digit five
6️⃣|数字六|keycap digit six
7️⃣|数字七|keycap digit seven
8️⃣|数字八|keycap digit eight
9️⃣|数字九|keycap digit nine
🔟|数字十|keycap ten
➕|加号|plus
➖|减号|minus
➗|除号|divide
✖️|乘号|multiply
♾️|无穷|infinity
💲|美元符号|heavy dollar sign
💱|货币兑换|currency exchange
™️|商标|trade mark
©️|版权|copyright
®️|注册商标|registered
〰️|波浪线|wavy dash
🔚|结束箭头|end arrow
🔙|返回箭头|back arrow
🔛|开启箭头|on arrow
🔝|置顶箭头|top arrow
🔜|即将箭头|soon arrow
🔴|红圆|red circle
🟠|橙圆|orange circle
🟡|黄圆|yellow circle
🟢|绿圆|green circle
🔵|蓝圆|blue circle
🟣|紫圆|purple circle
⚫|黑圆|black circle
⚪|白圆|white circle
🟤|棕圆|brown circle
🔺|红三角向上|red triangle pointed up
🔻|红三角向下|red triangle pointed down
🔸|小橙菱形|small orange diamond
🔹|小蓝菱形|small blue diamond
🔶|大橙菱形|large orange diamond
🔷|大蓝菱形|large blue diamond
🔳|白方块按钮|white square button
🔲|黑方块按钮|black square button
▶️|播放|play button
⏸️|暂停|pause button
⏹️|停止|stop button
⏺️|录制|record button
⏭️|下一曲|next track
⏮️|上一曲|last track
⏩|快进|fast forward
⏪|快退|fast reverse
⏫|快速向上|fast up button
⏬|快速向下|fast down button
🔀|随机播放|shuffle tracks
🔁|循环|repeat
🔂|单曲循环|repeat single
🔄|刷新|counterclockwise arrows
🕐|一点钟|one o clock
🕒|三点钟|three o clock
🕕|六点钟|six o clock
🕘|九点钟|nine o clock
🕛|十二点|twelve o clock
♠️|黑桃|spade suit
♥️|红桃|heart suit
♦️|方块|diamond suit
♣️|梅花|club suit
🎴|花札|flower playing cards
🀄|麻将红中|mahjong red dragon
☮️|和平符号|peace symbol
☯️|阴阳|yin yang
☪️|星月|star and crescent
✝️|十字架|latin cross
☦️|东正教十字|orthodox cross
🕉️|唵|om
✡️|大卫之星|star of david
☸️|法轮|wheel of dharma
🔯|六角星|dotted six pointed star
⚛️|原子|atom symbol
♈|白羊座|aries
♉|金牛座|taurus
♊|双子座|gemini
♋|巨蟹座|cancer
♌|狮子座|leo
♍|处女座|virgo
♎|天秤座|libra
♏|天蝎座|scorpio
♐|射手座|sagittarius
♑|摩羯座|capricorn
♒|水瓶座|aquarius
♓|双鱼座|pisces
⛎|蛇夫座|ophiuchus
🆔|身份证|id button
🈶|有|japanese here button
🈚|无|japanese free of charge button
🈲|日文禁止按钮|japanese prohibited button
🉐|得|japanese bargain button
㊙️|秘密|japanese secret button
㊗️|祝贺|japanese congratulations button
🈴|合格|japanese passing grade button
🈵|满|japanese no vacancy button
`,
};
