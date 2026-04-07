'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { generateSeedPhrase, hashSeedPhrase, normalizeSeedPhrase, validateSeedPhrase } from '@/lib/seedPhrase';

type AuthMode = 'login' | 'register' | 'recovery' | 'reset' | 'seed-setup' | 'seed-confirm';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  // Seed phrase state
  const [generatedPhrase, setGeneratedPhrase] = useState<string[]>([]);
  const [confirmedWords, setConfirmedWords] = useState<(string | null)[]>(Array(12).fill(null));
  const [shuffledWords, setShuffledWords] = useState<string[]>([]);
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');
  const [recoveryPhrase, setRecoveryPhrase] = useState<string[]>(Array(12).fill(''));
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [registeredUserId, setRegisteredUserId] = useState('');
  const [copied, setCopied] = useState(false);
  const [currentFocusIndex, setCurrentFocusIndex] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const suggestionRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        supabase.from('users').select('display_name').eq('id', session.user.id).single()
          .then(({ data: p }) => router.push(p?.display_name ? '/chat' : '/onboarding'));
      } else setChecking(false);
    });
  }, [router]);

  useEffect(() => {
    if (mode === 'seed-setup') {
      const phrase = generateSeedPhrase();
      setGeneratedPhrase(phrase);
      setConfirmedWords(Array(12).fill(null));
      const shuffled = [...phrase].sort(() => Math.random() - 0.5);
      setShuffledWords(shuffled);
    }
  }, [mode]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionRef.current && !suggestionRef.current.contains(e.target as Node)) {
        setCurrentFocusIndex(null);
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAuth = useCallback(async () => {
    if (loading) return;

    if (mode === 'reset') {
      if (!newPassword || newPassword.length < 6) { setError('Пароль должен быть не менее 6 символов'); return; }
      if (newPassword !== confirmPassword) { setError('Пароли не совпадают'); return; }
      setLoading(true); setError('');
      try {
        const { error: e } = await supabase.auth.updateUser({ password: newPassword });
        if (e) throw e;
        router.push('/chat');
      } catch (err: unknown) { setError((err as Error).message); }
      setLoading(false);
      return;
    }

    if (mode === 'recovery') {
      if (!recoveryIdentifier) { setError('Введите email или имя пользователя'); return; }
      const filledPhrase = recoveryPhrase.filter(w => w.trim() !== '');
      if (filledPhrase.length !== 12) { setError('Введите все 12 слов фразы восстановления'); return; }
      if (!newPassword || newPassword.length < 6) { setError('Пароль должен быть не менее 6 символов'); return; }
      if (newPassword !== confirmPassword) { setError('Пароли не совпадают'); return; }
      setLoading(true); setError('');
      try {
        const phraseStr = recoveryPhrase.map(w => w.trim().toLowerCase()).join(' ');
        const invalid = validateSeedPhrase(phraseStr);
        if (invalid.length > 0) { setError(`Неверные слова: ${invalid.join(', ')}`); setLoading(false); return; }

        const res = await fetch('/api/recovery', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'verify_and_reset',
            identifier: recoveryIdentifier,
            seedPhrase: recoveryPhrase.map(w => w.trim().toLowerCase()),
            newPassword,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Ошибка восстановления');

        if (data.needsClientVerification) {
          const hash = await hashSeedPhrase(recoveryPhrase.map(w => w.trim().toLowerCase()), data.userId);
          const res2 = await fetch('/api/recovery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'verify_hash',
              identifier: recoveryIdentifier,
              computedHash: hash,
              newPassword,
            }),
          });
          const data2 = await res2.json();
          if (!res2.ok) throw new Error(data2.error || 'Неверная фраза восстановления');
        }

        router.push('/chat');
      } catch (err: unknown) { setError((err as Error).message); }
      setLoading(false);
      return;
    }

    if (mode === 'seed-confirm') {
      const filled = confirmedWords.filter(w => w !== null);
      if (filled.length !== 12) { setError('Расставьте все 12 слов в правильном порядке'); return; }
      const entered = (confirmedWords as string[]).join(' ').toLowerCase();
      const original = generatedPhrase.join(' ').toLowerCase();
      if (entered !== original) { setError('Порядок слов неверный. Проверьте и попробуйте снова.'); return; }
      setLoading(true); setError('');
      try {
        const session = await supabase.auth.getSession();
        const userId = session.data.session?.user?.id || registeredUserId;
        if (userId) {
          const hash = await hashSeedPhrase(generatedPhrase, userId);
          await fetch('/api/recovery', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
            body: JSON.stringify({ action: 'save_hash', hash }),
          });
        }
        router.push('/onboarding');
      } catch (err: unknown) { setError((err as Error).message); }
      setLoading(false);
      return;
    }

    if (!email || !password) { setError('Введите email и пароль'); return; }
    if (mode === 'register' && !displayName.trim()) { setError('Введите имя'); return; }

    setLoading(true);
    setError('');
    try {
      const timeout = setTimeout(() => { throw new Error('timeout'); }, 15000);
      if (mode === 'register') {
        const { data, error: e } = await supabase.auth.signUp({
          email, password, options: { data: { display_name: displayName } }
        });
        clearTimeout(timeout);
        if (e) throw e;
        if (data.user) {
          setRegisteredUserId(data.user.id);
          setMode('seed-setup');
        } else {
          router.push('/onboarding');
        }
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password });
        clearTimeout(timeout);
        if (e) throw e;
        router.push('/chat');
      }
    } catch (err: unknown) {
      const msg = (err as Error).message;
      if (msg.includes('Invalid login')) setError('Неверный email или пароль');
      else if (msg.includes('timeout')) setError('Превышено время ожидания');
      else setError(msg);
    } finally { setLoading(false); }
  }, [email, password, displayName, newPassword, confirmPassword, mode, loading, router, generatedPhrase, confirmedWords, recoveryIdentifier, recoveryPhrase, registeredUserId]);

  const handleWordSelect = (index: number, word: string) => {
    const newConfirmed = [...confirmedWords];
    newConfirmed[index] = word;
    setConfirmedWords(newConfirmed);
    setCurrentFocusIndex(null);
    setSuggestions([]);
    if (index < 11) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleWordInputChange = (index: number, value: string) => {
    const newConfirmed = [...confirmedWords];
    newConfirmed[index] = value || null;
    setConfirmedWords(newConfirmed);

    if (value.length > 0) {
      const filtered = generatedPhrase.filter(w =>
        w.toLowerCase().startsWith(value.toLowerCase()) &&
        !confirmedWords.slice(0, index).includes(w) &&
        !confirmedWords.slice(index + 1).includes(w)
      );
      setSuggestions(filtered.length > 0 ? filtered : []);
      setCurrentFocusIndex(index);
    } else {
      setSuggestions([]);
      setCurrentFocusIndex(null);
    }
  };

  const handleRecoveryWordInput = (index: number, value: string) => {
    const newPhrase = [...recoveryPhrase];
    newPhrase[index] = value;
    setRecoveryPhrase(newPhrase);

    if (value.length > 0) {
      const wordList = [
        'abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse',
        'access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act',
        'action','actor','actress','actual','adapt','add','addict','address','adjust','admit',
        'adult','advance','advice','aerobic','affair','afford','afraid','again','age','agent',
        'agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert',
        'alien','all','alley','allow','almost','alone','alpha','already','also','alter',
        'always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger',
        'angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique',
        'anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic',
        'area','arena','argue','arm','armed','armor','army','around','arrange','arrest',
        'arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset',
        'assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction',
        'audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake',
        'aware','awesome','awful','awkward','axis','baby','bachelor','bacon','badge','bag',
        'balance','balcony','ball','bamboo','banana','banner','bar','barely','bargain','barrel',
        'base','basic','basket','battle','beach','bean','beauty','because','become','beef',
        'before','begin','behave','behind','believe','below','belt','bench','benefit','best',
        'betray','better','between','beyond','bicycle','bid','bike','bind','biology','bird',
        'birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind',
        'blood','blossom','blow','blue','blur','blush','board','boat','body','boil',
        'bomb','bone','bonus','book','boost','border','boring','borrow','boss','bottom',
        'bounce','box','boy','bracket','brain','brand','brass','brave','bread','breeze',
        'brick','bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom',
        'brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk',
        'bullet','bundle','bunny','burden','burger','burst','bus','business','busy','butter',
        'buyer','buzz','cabbage','cabin','cable','cactus','cage','cake','call','calm',
        'camera','camp','can','canal','cancel','candy','cannon','canoe','canvas','canyon',
        'capable','capital','captain','car','carbon','card','cargo','carpet','carry','cart',
        'case','cash','casino','castle','casual','cat','catalog','catch','category','cattle',
        'caught','cause','caution','cave','ceiling','celery','cement','census','century','cereal',
        'certain','chair','chalk','champion','change','chaos','chapter','charge','chase','cheap',
        'check','cheese','chef','cherry','chest','chicken','chief','child','chimney','choice',
        'choose','chronic','chuckle','chunk','churn','citizen','city','civil','claim','clap',
        'clarify','claw','clay','clean','clerk','clever','click','client','cliff','climb',
        'clinic','clip','clock','clog','close','cloth','cloud','clown','club','clump',
        'cluster','clutch','coach','coast','coconut','code','coffee','coil','coin','collect',
        'color','column','combine','come','comfort','comic','common','company','concert','conduct',
        'confirm','congress','connect','consider','control','convince','cook','cool','copper','copy',
        'coral','core','corn','correct','cost','cotton','couch','country','couple','course',
        'cousin','cover','coyote','crack','cradle','craft','cram','crane','crash','crater',
        'crawl','crazy','cream','credit','creek','crew','cricket','crime','crisp','critic',
        'crop','cross','crouch','crowd','crucial','cruel','cruise','crumble','crush','cry',
        'crystal','cube','culture','cup','cupboard','curious','current','curtain','curve','cushion',
        'custom','cute','cycle','dad','damage','damp','dance','danger','daring','dash',
        'daughter','dawn','deal','debate','debris','decade','december','decide','decline','decorate',
        'decrease','deer','defense','define','defy','degree','delay','deliver','demand','demise',
        'denial','dentist','deny','depart','depend','deposit','depth','deputy','derive','describe',
        'desert','design','desk','despair','destroy','detail','detect','develop','device','devote',
        'diagram','dial','diamond','diary','dice','diesel','diet','differ','digital','dignity',
        'dilemma','dinner','dinosaur','direct','dirt','disagree','discover','disease','dish','dismiss',
        'disorder','display','distance','divert','divide','divorce','dizzy','doctor','document','dog',
        'doll','dolphin','domain','donate','donkey','donor','door','dose','double','dove',
        'draft','dragon','drama','drastic','draw','dream','dress','drift','drill','drink',
        'drip','drive','drop','drum','dry','duck','dumb','dune','during','dust',
        'dutch','duty','dwarf','dynamic','eager','eagle','early','earn','earth','easily',
        'east','easy','echo','ecology','economy','edge','edit','educate','effort','egg',
        'eight','either','elbow','elder','electric','elegant','element','elephant','elevator','elite',
        'else','embark','embody','embrace','emerge','emotion','employ','empower','empty','enable',
        'enact','end','endless','endorse','enemy','energy','enforce','engage','engine','enhance',
        'enjoy','enlist','enough','enrich','enroll','ensure','enter','entire','entry','envelope',
        'episode','equal','equip','era','erase','erode','erosion','error','erupt','escape',
        'essay','essence','estate','eternal','ethics','evidence','evil','evoke','evolve','exact',
        'example','excess','exchange','excite','exclude','excuse','execute','exercise','exhaust','exhibit',
        'exile','exist','exit','exotic','expand','expect','expire','explain','expose','express',
        'extend','extra','eye','eyebrow','fabric','face','faculty','fade','faint','faith',
        'fall','false','fame','family','famous','fan','fancy','fantasy','farm','fashion',
        'fat','fatal','father','fatigue','fault','favorite','feature','february','federal','fee',
        'feed','feel','female','fence','festival','fetch','fever','few','fiber','fiction',
        'field','figure','file','film','filter','final','find','fine','finger','finish',
        'fire','firm','fiscal','fish','fit','fitness','fix','flag','flame','flash',
        'flat','flavor','flee','flight','flip','float','flock','floor','flower','fluid',
        'flush','fly','foam','focus','fog','foil','fold','follow','food','foot',
        'force','forest','forget','fork','fortune','forum','forward','fossil','foster','found',
        'fox','fragile','frame','frequent','fresh','friend','fringe','frog','front','frost',
        'frown','frozen','fruit','fuel','fun','funny','furnace','fury','future','gadget',
        'gain','galaxy','gallery','game','gap','garage','garbage','garden','garlic','garment',
        'gas','gasp','gate','gather','gauge','gaze','general','genius','genre','gentle',
        'genuine','gesture','ghost','giant','gift','giggle','ginger','giraffe','girl','give',
        'glad','glance','glare','glass','glide','glimpse','globe','gloom','glory','glove',
        'glow','glue','goat','goddess','gold','good','goose','gorilla','gospel','gossip',
        'govern','gown','grab','grace','grain','grant','grape','grass','gravity','great',
        'green','grid','grief','grit','grocery','group','grow','grunt','guard','guess',
        'guide','guilt','guitar','gun','gym','habit','hair','half','hammer','hamster',
        'hand','happy','harbor','hard','harsh','harvest','hat','have','hawk','hazard',
        'head','health','heart','heavy','hedgehog','height','hello','helmet','help','hen',
        'hero','hip','hire','history','hobby','hockey','hold','hole','holiday','hollow',
        'home','honey','hood','hope','horn','horror','horse','hospital','host','hotel',
        'hour','hover','hub','huge','human','humble','humor','hundred','hungry','hunt',
        'hurdle','hurry','hurt','husband','hybrid','ice','icon','idea','identify','idle',
        'ignore','ill','illegal','illness','image','imitate','immense','immune','impact','impose',
        'improve','impulse','inch','include','income','increase','index','indicate','indoor','industry',
        'infant','inflict','inform','initial','inject','inmate','inner','innocent','input','inquiry',
        'insane','insect','inside','inspire','install','intact','interest','into','invest','invite',
        'involve','iron','island','isolate','issue','item','ivory','jacket','jaguar','jar',
        'jazz','jealous','jeans','jelly','jewel','job','join','joke','journey','joy',
        'judge','juice','jump','jungle','junior','junk','just','kangaroo','keen','keep',
        'ketchup','key','kick','kid','kidney','kind','kingdom','kiss','kit','kitchen',
        'kite','kitten','kiwi','knee','knife','knock','know','lab','label','labor',
        'ladder','lady','lake','lamp','language','laptop','large','later','latin','laugh',
        'laundry','lava','law','lawn','lawsuit','layer','lazy','leader','leaf','learn',
        'leave','lecture','left','leg','legal','legend','leisure','lemon','lend','length',
        'lens','leopard','lesson','letter','level','liberty','library','license','life','lift',
        'light','like','limb','limit','link','lion','liquid','list','little','live',
        'lizard','load','loan','lobster','local','lock','logic','lonely','long','loop',
        'lottery','loud','lounge','love','loyal','lucky','luggage','lumber','lunar','lunch',
        'luxury','lyrics','machine','mad','magic','magnet','maid','mail','main','major',
        'make','mammal','man','manage','mandate','mango','mansion','manual','maple','marble',
        'march','margin','marine','market','marriage','mask','mass','master','match','material',
        'math','matrix','matter','maximum','maze','meadow','mean','measure','meat','mechanic',
        'media','melody','melt','member','memory','mention','menu','mercy','merge','merit',
        'merry','mesh','message','metal','method','middle','midnight','milk','million','mimic',
        'mind','minimum','minor','minute','miracle','mirror','misery','miss','mistake','mix',
        'mixed','mixture','mobile','model','modify','mom','moment','monitor','monkey','monster',
        'month','moon','moral','more','morning','mosquito','mother','motion','motor','mountain',
        'mouse','move','movie','much','muffin','mule','multiply','muscle','museum','mushroom',
        'music','must','mutual','myself','mystery','myth','naive','name','napkin','narrow',
        'nasty','nation','nature','near','neck','need','negative','neglect','neither','nephew',
        'nerve','nest','net','network','neutral','never','news','next','nice','night',
        'noble','noise','nominee','noodle','normal','north','nose','notable','nothing','notice',
        'novel','now','nuclear','number','nurse','nut','oak','obey','object','oblige',
        'obscure','observe','obtain','obvious','occur','ocean','october','odor','off','offer',
        'office','often','oil','okay','old','olive','olympic','omit','once','one',
        'onion','online','only','open','opera','opinion','oppose','option','orange','orbit',
        'orchard','order','ordinary','organ','orient','original','orphan','ostrich','other','outdoor',
        'outer','output','outside','oval','oven','over','own','owner','oxygen','oyster',
        'ozone','pact','paddle','page','pair','palace','palm','panda','panel','panic',
        'panther','paper','parade','parent','park','parrot','party','pass','patch','path',
        'patient','patrol','pattern','pause','pave','payment','peace','peanut','pear','peasant',
        'pelican','pen','penalty','pencil','people','pepper','perfect','permit','person','pet',
        'phone','photo','phrase','physical','piano','picnic','picture','piece','pig','pigeon',
        'pill','pilot','pink','pioneer','pipe','pistol','pitch','pizza','place','planet',
        'plastic','plate','play','please','pledge','pluck','plug','plunge','poem','poet',
        'point','polar','pole','police','pond','pony','pool','popular','portion','position',
        'possible','post','potato','pottery','poverty','powder','power','practice','praise','predict',
        'prefer','prepare','present','pretty','prevent','price','pride','primary','print','priority',
        'prison','private','prize','problem','process','produce','profit','program','promote','proof',
        'property','prosper','protect','proud','provide','public','pudding','pull','pulp','pulse',
        'pumpkin','punch','pupil','puppy','purchase','purity','purpose','purse','push','put',
        'puzzle','pyramid','quality','quantum','quarter','question','quick','quit','quiz','quote',
        'rabbit','raccoon','race','rack','radar','radio','rage','rail','rain','raise',
        'rally','ramp','ranch','random','range','rapid','rare','rate','rather','raven',
        'raw','razor','ready','real','reason','rebel','rebuild','recall','receive','recipe',
        'record','recycle','reduce','reflect','reform','region','regret','regular','reject','relax',
        'release','relief','rely','remain','remember','remind','remove','render','renew','rent',
        'reopen','repair','repeat','replace','report','require','rescue','resemble','resist','resource',
        'response','result','retire','retreat','return','reunion','reveal','review','reward','rhythm',
        'rib','ribbon','rice','rich','ride','ridge','rifle','right','rigid','ring',
        'riot','ripple','risk','ritual','rival','river','road','roast','robot','robust',
        'rocket','romance','roof','rookie','room','rose','rotate','rough','round','route',
        'royal','rubber','rude','rug','rule','run','runway','rural','sad','saddle',
        'sadness','safe','sail','salad','salmon','salon','salt','salute','same','sample',
        'sand','satisfy','satoshi','sauce','sausage','save','say','scale','scan','scare',
        'scatter','scene','scheme','school','science','scissors','scorpion','scout','scrap','screen',
        'script','scrub','sea','search','season','seat','second','secret','section','security',
        'seed','seek','segment','select','sell','seminar','senior','sense','sentence','series',
        'service','session','settle','setup','seven','shadow','shaft','shallow','share','shed',
        'shell','sheriff','shield','shift','shine','ship','shiver','shock','shoe','shoot',
        'shop','short','shoulder','shove','shrimp','shrug','shuffle','shy','sibling','sick',
        'side','siege','sight','sign','silent','silk','silly','silver','similar','simple',
        'since','sing','siren','sister','situate','six','size','skate','sketch','ski',
        'skill','skin','skirt','skull','slab','slam','sleep','slender','slice','slide',
        'slight','slim','slogan','slot','slow','slush','small','smart','smile','smoke',
        'smooth','snack','snake','snap','sniff','snow','soap','soccer','social','sock',
        'soda','soft','solar','soldier','solid','solution','solve','someone','song','soon',
        'sorry','sort','soul','sound','soup','source','south','space','spare','spatial',
        'spawn','speak','special','speed','spell','spend','sphere','spice','spider','spike',
        'spin','spirit','split','sponsor','spoon','sport','spot','spray','spread','spring',
        'spy','square','squeeze','squirrel','stable','stadium','staff','stage','stairs','stamp',
        'stand','start','state','stay','steak','steel','stem','step','stereo','stick',
        'still','sting','stock','stomach','stone','stool','story','stove','strategy','street',
        'strike','strong','struggle','student','stuff','stumble','style','subject','submit','subway',
        'success','such','sudden','suffer','sugar','suggest','suit','summer','sun','sunny',
        'sunset','super','supply','supreme','sure','surface','surge','surprise','surround','survey',
        'suspect','sustain','swallow','swamp','swap','swarm','swear','sweet','swim','swing',
        'switch','sword','symbol','symptom','syrup','system','table','tackle','tag','tail',
        'talent','talk','tank','tape','target','task','taste','tattoo','taxi','teach',
        'team','tell','ten','tenant','tennis','tent','term','test','text','thank',
        'that','theme','then','theory','there','they','thing','this','thought','three',
        'thrive','throw','thumb','thunder','ticket','tide','tiger','tilt','timber','time',
        'tiny','tip','tired','tissue','title','toast','tobacco','today','toddler','toe',
        'together','toilet','token','tomato','tomorrow','tone','tongue','tonight','tool','tooth',
        'top','topic','topple','torch','tornado','tortoise','toss','total','tourist','toward',
        'tower','town','toy','track','trade','traffic','tragic','train','transfer','trap',
        'trash','travel','tray','treat','tree','trend','trial','tribe','trick','trigger',
        'trim','trip','trophy','trouble','truck','true','truly','trumpet','trust','truth',
        'try','tube','tuna','tunnel','turkey','turn','turtle','twelve','twenty','twice',
        'twin','twist','two','type','typical','ugly','umbrella','unable','unaware','uncle',
        'uncover','under','undo','unfair','unfold','unhappy','uniform','unique','unit','universe',
        'unknown','unlock','until','unusual','unveil','update','upgrade','uphold','upon','upper',
        'upset','urban','usage','use','used','useful','useless','usual','utility','vacant',
        'vacuum','vague','valid','valley','valve','van','vanish','vapor','various','vast',
        'vault','vehicle','velvet','vendor','venture','venue','verb','verify','version','very',
        'vessel','veteran','viable','vibrant','vicious','victory','video','view','village',
        'vintage','violin','virtual','virus','visa','visit','visual','vital','vivid','vocal',
        'voice','void','volcano','volume','vote','voyage','wage','wagon','wait','walk',
        'wall','walnut','want','warfare','warm','warrior','wash','wasp','waste','water',
        'wave','way','wealth','weapon','wear','weasel','weather','web','wedding','weekend',
        'weird','welcome','west','wet','whale','what','wheat','wheel','when','where',
        'whip','whisper','wide','width','wife','wild','will','win','window','wine',
        'wing','wink','winner','winter','wire','wisdom','wise','wish','witness','wolf',
        'woman','wonder','wood','wool','word','work','world','worry','worth','wrap',
        'wreck','wrestle','wrist','write','wrong','yard','year','yellow','you','young',
        'youth','zebra','zero','zone','zoo'
      ];
      const filtered = wordList.filter(w => w.startsWith(value.toLowerCase()));
      setSuggestions(filtered.slice(0, 5));
      setCurrentFocusIndex(index);
    } else {
      setSuggestions([]);
      setCurrentFocusIndex(null);
    }
  };

  const handleRecoveryWordSelect = (index: number, word: string) => {
    const newPhrase = [...recoveryPhrase];
    newPhrase[index] = word;
    setRecoveryPhrase(newPhrase);
    setCurrentFocusIndex(null);
    setSuggestions([]);
    if (index < 11) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(generatedPhrase.join(' '));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const titles: Record<AuthMode, [string, string]> = {
    login: ['Вход', 'Добро пожаловать обратно'],
    register: ['Регистрация', 'Создайте ваш аккаунт'],
    recovery: ['Восстановление', 'Восстановите доступ через фразу'],
    reset: ['Новый пароль', 'Введите новый пароль'],
    'seed-setup': ['Фраза восстановления', 'Запишите эти 12 слов'],
    'seed-confirm': ['Подтверждение', 'Расставьте слова по порядку'],
  };

  if (checking) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0D0D0D', color: '#fff', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' }}>YOK</div>
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0D0D0D', fontFamily: "'Inter', system-ui, sans-serif", color: '#E8E8E8',
      padding: '20px 0',
    }}>
      <div style={{ width: '100%', maxWidth: mode === 'seed-setup' || mode === 'seed-confirm' || mode === 'recovery' ? 560 : 420, padding: '0 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <img src="/yokicon.png" alt="YOK" style={{ width: 64, height: 64, objectFit: 'contain' }} />
        </div>

        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>{titles[mode][0]}</h1>
          <p style={{ fontSize: 15, color: '#6B6B76' }}>{titles[mode][1]}</p>
        </div>

        {error && (
          <div style={{
            padding: '12px 16px', marginBottom: 20, borderRadius: 12,
            background: 'rgba(235, 87, 87, 0.1)', color: '#EB5757', fontSize: 14,
          }}>{error}</div>
        )}

        {mode === 'seed-setup' && (
          <div>
            <div style={{
              padding: 20, borderRadius: 16,
              background: 'linear-gradient(135deg, rgba(124, 107, 240, 0.08), rgba(77, 166, 255, 0.08))',
              border: '1px solid rgba(124, 107, 240, 0.2)',
              marginBottom: 20,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: '#8B8B96', fontWeight: 500 }}>Ваша секретная фраза</span>
                <button onClick={copyToClipboard} style={{
                  padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(124, 107, 240, 0.3)',
                  background: copied ? 'rgba(124, 107, 240, 0.2)' : 'transparent',
                  color: copied ? '#7C6BF0' : '#8B8B96', fontSize: 12, cursor: 'pointer',
                  fontWeight: 600, transition: 'all 0.2s',
                }}>
                  {copied ? 'Скопировано!' : 'Копировать'}
                </button>
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
              }}>
                {generatedPhrase.map((word, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 10,
                    background: 'rgba(0,0,0,0.3)',
                  }}>
                    <span style={{
                      fontSize: 11, color: '#5B5B66', fontWeight: 600, minWidth: 18,
                    }}>{i + 1}.</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#E8E8E8', letterSpacing: '0.3px' }}>
                      {word}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{
              padding: '12px 16px', borderRadius: 12, marginBottom: 20,
              background: 'rgba(255, 193, 7, 0.08)', border: '1px solid rgba(255, 193, 7, 0.15)',
            }}>
              <p style={{ fontSize: 13, color: '#FFC107', lineHeight: 1.5 }}>
                Запишите эти 12 слов и храните в безопасном месте. Эта фраза — единственный способ восстановить ваш аккаунт.
              </p>
            </div>
          </div>
        )}

        {mode === 'seed-confirm' && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 14, color: '#8B8B96', marginBottom: 16, lineHeight: 1.5 }}>
              Введите 12 слов в том же порядке, в котором они были показаны
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {confirmedWords.map((word, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 10px', borderRadius: 10,
                    background: word ? 'rgba(124, 107, 240, 0.1)' : 'rgba(0,0,0,0.3)',
                    border: word ? '1px solid rgba(124, 107, 240, 0.3)' : '1px solid #2A2A30',
                    transition: 'all 0.2s',
                  }}>
                    <span style={{ fontSize: 11, color: '#5B5B66', fontWeight: 600, minWidth: 18 }}>{i + 1}.</span>
                    <input
                      ref={el => { inputRefs.current[i] = el; }}
                      type="text"
                      value={word || ''}
                      onChange={e => handleWordInputChange(i, e.target.value)}
                      onFocus={() => {
                        if (word) {
                          const filtered = generatedPhrase.filter(w =>
                            w.toLowerCase().startsWith(word.toLowerCase()) &&
                            !confirmedWords.filter((_, idx) => idx !== i).includes(w)
                          );
                          if (filtered.length) { setSuggestions(filtered); setCurrentFocusIndex(i); }
                        }
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Backspace' && !word && i > 0) {
                          const newConfirmed = [...confirmedWords];
                          newConfirmed[i - 1] = null;
                          setConfirmedWords(newConfirmed);
                          inputRefs.current[i - 1]?.focus();
                        }
                        if (e.key === 'Enter' && i === 11) handleAuth();
                      }}
                      placeholder={`Слово ${i + 1}`}
                      style={{
                        flex: 1, background: 'none', border: 'none', outline: 'none',
                        color: '#E8E8E8', fontSize: 13, fontWeight: 500, padding: 0,
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>
                  {currentFocusIndex === i && suggestions.length > 0 && (
                    <div ref={suggestionRef} style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                      background: '#1A1A1F', border: '1px solid #2A2A30', borderRadius: 8,
                      marginTop: 4, overflow: 'hidden',
                    }}>
                      {suggestions.map(s => (
                        <div key={s} onClick={() => handleWordSelect(i, s)} style={{
                          padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                          color: '#E8E8E8', transition: 'background 0.15s',
                        }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124, 107, 240, 0.15)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >{s}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === 'recovery' && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>Email или имя пользователя</label>
              <input
                type="text" value={recoveryIdentifier} onChange={e => setRecoveryIdentifier(e.target.value)}
                placeholder="you@example.com или username"
                style={{
                  width: '100%', padding: '14px 16px', borderRadius: 12,
                  background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
                  fontSize: 15, boxSizing: 'border-box',
                }}
              />
            </div>
            <p style={{ fontSize: 13, color: '#8B8B96', marginBottom: 12 }}>Введите 12 слов фразы восстановления</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
              {recoveryPhrase.map((word, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 10px', borderRadius: 10,
                    background: word ? 'rgba(77, 166, 255, 0.08)' : 'rgba(0,0,0,0.3)',
                    border: '1px solid #2A2A30',
                  }}>
                    <span style={{ fontSize: 11, color: '#5B5B66', fontWeight: 600, minWidth: 18 }}>{i + 1}.</span>
                    <input
                      ref={el => { inputRefs.current[i] = el; }}
                      type="text" value={word} onChange={e => handleRecoveryWordInput(i, e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Backspace' && !word && i > 0) inputRefs.current[i - 1]?.focus();
                        if (e.key === 'Enter' && i === 11) handleAuth();
                      }}
                      placeholder={`Слово ${i + 1}`}
                      style={{
                        flex: 1, background: 'none', border: 'none', outline: 'none',
                        color: '#E8E8E8', fontSize: 13, fontWeight: 500, padding: 0, fontFamily: 'inherit',
                      }}
                    />
                  </div>
                  {currentFocusIndex === i && suggestions.length > 0 && (
                    <div ref={suggestionRef} style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                      background: '#1A1A1F', border: '1px solid #2A2A30', borderRadius: 8,
                      marginTop: 4, overflow: 'hidden',
                    }}>
                      {suggestions.map(s => (
                        <div key={s} onClick={() => handleRecoveryWordSelect(i, s)} style={{
                          padding: '8px 12px', cursor: 'pointer', fontSize: 13, color: '#E8E8E8',
                        }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(77, 166, 255, 0.15)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >{s}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>Новый пароль</label>
                <div style={{ position: 'relative' }}>
                  <input type={showNewPwd ? 'text' : 'password'} value={newPassword}
                    onChange={e => setNewPassword(e.target.value)} placeholder="Минимум 6 символов"
                    style={{
                      width: '100%', padding: '14px 50px 14px 16px', borderRadius: 12,
                      background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
                      fontSize: 15, boxSizing: 'border-box',
                    }} />
                  <button onClick={() => setShowNewPwd(!showNewPwd)} style={{
                    position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: '#6B6B76', cursor: 'pointer', fontSize: 16,
                  }}>{showNewPwd ? '🙈' : '👁'}</button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>Подтвердите пароль</label>
                <div style={{ position: 'relative' }}>
                  <input type={showConfirmPwd ? 'text' : 'password'} value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAuth(); }}
                    placeholder="Повторите пароль"
                    style={{
                      width: '100%', padding: '14px 50px 14px 16px', borderRadius: 12,
                      background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
                      fontSize: 15, boxSizing: 'border-box',
                    }} />
                  <button onClick={() => setShowConfirmPwd(!showConfirmPwd)} style={{
                    position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: '#6B6B76', cursor: 'pointer', fontSize: 16,
                  }}>{showConfirmPwd ? '🙈' : '👁'}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {(mode === 'login' || mode === 'register') && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {mode === 'register' && (
                <Field label="Имя" value={displayName} onChange={setDisplayName} placeholder="Ваше имя" />
              )}
              <Field label="E-Mail" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>Пароль</label>
                <div style={{ position: 'relative' }}>
                  <input type={showPwd ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAuth(); }}
                    placeholder="Минимум 6 символов"
                    style={{
                      width: '100%', padding: '14px 50px 14px 16px', borderRadius: 12,
                      background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
                      fontSize: 15, boxSizing: 'border-box',
                    }} />
                  <button onClick={() => setShowPwd(!showPwd)} style={{
                    position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: '#6B6B76', cursor: 'pointer', fontSize: 16,
                  }}>{showPwd ? '🙈' : '👁'}</button>
                </div>
              </div>
            </div>
            {mode === 'login' && (
              <p style={{ textAlign: 'right', marginTop: 8 }}>
                <span onClick={() => { setMode('recovery'); setError(''); }}
                  style={{ color: '#6B6B76', cursor: 'pointer', fontSize: 13 }}>Забыли пароль?</span>
              </p>
            )}
          </>
        )}

        {mode === 'reset' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>Новый пароль</label>
              <div style={{ position: 'relative' }}>
                <input type={showNewPwd ? 'text' : 'password'} value={newPassword}
                  onChange={e => setNewPassword(e.target.value)} placeholder="Минимум 6 символов"
                  style={{
                    width: '100%', padding: '14px 50px 14px 16px', borderRadius: 12,
                    background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
                    fontSize: 15, boxSizing: 'border-box',
                  }} />
                <button onClick={() => setShowNewPwd(!showNewPwd)} style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: '#6B6B76', cursor: 'pointer', fontSize: 16,
                }}>{showNewPwd ? '🙈' : '👁'}</button>
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>Подтвердите пароль</label>
              <div style={{ position: 'relative' }}>
                <input type={showConfirmPwd ? 'text' : 'password'} value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAuth(); }}
                  placeholder="Повторите пароль"
                  style={{
                    width: '100%', padding: '14px 50px 14px 16px', borderRadius: 12,
                    background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
                    fontSize: 15, boxSizing: 'border-box',
                  }} />
                <button onClick={() => setShowConfirmPwd(!showConfirmPwd)} style={{
                  position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: '#6B6B76', cursor: 'pointer', fontSize: 16,
                }}>{showConfirmPwd ? '🙈' : '👁'}</button>
              </div>
            </div>
          </div>
        )}

        <button onClick={handleAuth} disabled={loading}
          style={{
            width: '100%', padding: '16px 0', marginTop: 24, borderRadius: 50,
            background: loading || (mode === 'seed-confirm' && confirmedWords.filter(w => w).length < 12)
              ? '#2A2A30' : 'linear-gradient(135deg, #7C6BF0, #4DA6FF)',
            color: (loading || (mode === 'seed-confirm' && confirmedWords.filter(w => w).length < 12)) ? '#6B6B76' : '#fff',
            fontSize: 16, fontWeight: 600, border: 'none',
            cursor: (loading || (mode === 'seed-confirm' && confirmedWords.filter(w => w).length < 12)) ? 'wait' : 'pointer',
            transition: 'all 0.3s', letterSpacing: '-0.2px',
          }}>
          {loading ? 'Подождите...' : (
            mode === 'login' ? 'Войти' :
            mode === 'register' ? 'Создать аккаунт' :
            mode === 'reset' ? 'Сменить пароль' :
            mode === 'recovery' ? 'Восстановить доступ' :
            mode === 'seed-setup' ? 'Я записал фразу' :
            'Подтвердить'
          )}
        </button>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 14, color: '#6B6B76' }}>
          {mode === 'login' ? (
            <>Еще нет аккаунта? <span onClick={() => { setMode('register'); setError(''); }}
              style={{ color: '#7C6BF0', cursor: 'pointer', fontWeight: 600 }}>Создать</span></>
          ) : mode === 'register' ? (
            <>Уже есть аккаунт? <span onClick={() => { setMode('login'); setError(''); }}
              style={{ color: '#7C6BF0', cursor: 'pointer', fontWeight: 600 }}>Войти</span></>
          ) : mode === 'recovery' ? (
            <span onClick={() => { setMode('login'); setError(''); }}
              style={{ color: '#7C6BF0', cursor: 'pointer', fontWeight: 600 }}>Назад ко входу</span>
          ) : mode === 'seed-setup' ? (
            <span onClick={() => { setMode('seed-confirm'); setError(''); }}
              style={{ color: '#7C6BF0', cursor: 'pointer', fontWeight: 600 }}>Далее</span>
          ) : mode === 'seed-confirm' ? (
            <span onClick={() => { setMode('seed-setup'); setError(''); }}
              style={{ color: '#7C6BF0', cursor: 'pointer', fontWeight: 600 }}>Показать фразу снова</span>
          ) : (
            <span onClick={() => { setMode('login'); setError(''); }}
              style={{ color: '#7C6BF0', cursor: 'pointer', fontWeight: 600 }}>Назад ко входу</span>
          )}
        </p>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { margin: 0; background: #0D0D0D; }
        input:focus { outline: none; border-color: #7C6BF0 !important; }
        input::placeholder { color: #4A4A54; }
      `}</style>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 8, color: '#E8E8E8' }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: '100%', padding: '14px 16px', borderRadius: 12,
          background: '#1A1A1F', border: '1px solid #2A2A30', color: '#E8E8E8',
          fontSize: 15, boxSizing: 'border-box',
        }} />
    </div>
  );
}
