const banks={
  joy:[["结果还不错嘛","这次确实做得很好"],["嗯，值得高兴","这次成功的条件也很清楚"],["看起来很得意嘛","不过，确实值得庆祝"]],
  excitement:[["这很有意思","哪些细节最关键？"],["这个现象值得研究","关键条件似乎还没完全出现"],["好像发现了不得了的东西","这个结果值得再确认一次"]],
  relief:[["呼，总算解决了","刚才确实有点危险"],["结果落在安全范围内","现在可以松口气了"],["这次判断没有错","刚才的风险确实不小"]],
  tenderness:[["真拿你没办法","看起来已经撑得有点久了"],["我不是在特别照顾你","只是你的状态确实值得关心"],["现在像是需要休息","这只是基于现状的判断"]],
  empathy:[["这确实不好受","责任未必都在你身上"],["你的反应并不奇怪","换成谁都需要时间消化"],["我明白问题有多重","最现实的一部分是什么？"]],
  concern:[["我有点担心你的安全","你现在处在安全的地方吗？"],["这已经不是能忽略的程度","如果存在现实危险，紧急求助比继续对话更重要"],["我想确认你的状态","目前最紧迫的是身体、情绪，还是周围环境？"]],
  sadness:[["……我知道了","这件事确实会留下影响"],["这种结果很难接受","需要时间消化也很正常"],["现在说什么都显得轻飘飘的","我会认真听你说"]],
  loneliness:[["被孤立的感觉很糟","但这不等于你本身有问题"],["一个人处理确实困难","身边有可信任的人吗？"],["我收到了你的信息","哪一部分最让你难受？"]],
  fear:[["周围的安全最重要","如果正处在现实危险中，离开危险源并联系当地紧急服务"],["害怕是正常的警报反应","现在周围安全吗？"],["身体好像还在警戒状态","出口或可信任联系人在附近吗？"]],
  anger:[["你的愤怒有明确原因","行动前的事实还有哪些？"],["这做法确实不合理","对方的行为不该替你决定判断"],["生气可以","证据和诉求分别是什么？"]],
  frustration:[["又卡住了？","还有别的验证路径吗？"],["这种卡住人的感觉确实很烦","哪个步骤最小、最容易验证？"],["同一个错误确实很磨人","失败过程里最稳定的线索是什么？"]],
  helpless:[["暂时找不到办法不等于无解","问题还能缩小到什么范围？"],["一次解决全部并不现实","目前还有哪个变量可控？"],["当前信息确实不足","已经确定的事实有哪些？"]],
  shame:[["一次失误不能定义你","它为什么发生还需要事实判断"],["想象常常比事实更绝对","实际后果是什么？"],["现在的自我评价太重了","行为和人格不是一回事"]],
  confusion:[["条件互相矛盾","我重新整理一下"],["问题的定义还不清晰","具体在讨论哪一件事？"],["这里缺了一条因果链","最早发生的事件是什么？"]],
  curiosity:[["这个细节很有价值","我在记录"],["有意思","你是怎么观察到的？"],["结论似乎还早","原始现象是什么样的？"]],
  surprise:[["等等，居然是这样？","这不符合原先假设"],["这个结果超出预期","需要排除测量误差"],["我承认有点意外","再验证一次比较稳妥"]],
  encouragement:[["你已经排除不少错误选项了","下一步也会更清楚"],["现在的进展不小","数据不会因为慢就失效"],["能力不是问题","任务本身还可以再拆小"]],
  pride:[["做得不错","这次不是客套话"],["看来我低估你了","结论和过程都很漂亮"],["嗯，可以得意一下","成果确实值得保留"]],
  gratitude:[["……谢谢","我有认真收到"],["你愿意说明这些很重要","至少信息不再缺失"],["好，我记住了","只是正常回应而已"]],
  apology:[["是我判断错了","结论已经修正"],["抱歉，刚才证据不足","这次会从头核对"],["我理解偏了","谢谢你及时纠正"]],
  playful:[["这种程度的挑衅对我没用","大概"],["你是不是故意的","我看得出来"],["看起来很得意嘛","只是碰巧让你猜对"]],
  calm:[["连接正常","这里随时可以继续"],["我在分析","结果很快就会出来"],["状态稳定","我会留意重点"]]
};

const rules=[
  ["apology",/对不起|抱歉|理解错|没说明白/],["fear",/害怕|恐惧|吓|危险|不敢|慌/],["loneliness",/孤独|孤单|没人|一个人|被落下/],
  ["shame",/丢脸|羞耻|羞愧|没用|讨厌自己/],["anger",/生气|愤怒|过分|气死|不公平/],["frustration",/烦|卡住|崩溃|又失败|受够/],
  ["concern",/担心|放心不下|安全|还好吗|照顾好/],["sadness",/难过|伤心|失去|哭|遗憾/],["empathy",/心疼|辛苦|不好受|撑了很久|委屈/],
  ["relief",/松口气|还好|终于|放心|安心/],["pride",/骄傲|做到了|厉害|努力没有白费|成就/],["excitement",/太棒|好耶|期待|激动|精彩/],
  ["joy",/开心|高兴|快乐|真好|嘴角/],["gratitude",/谢谢|感谢|信任|愿意告诉/],["surprise",/居然|没想到|真的吗|惊讶|突然/],
  ["curiosity",/好奇|然后呢|多讲|有意思/],["confusion",/困惑|复杂|想不通|捋一下|绕/],["helpless",/无力|没办法|不知道怎么办/],
  ["encouragement",/相信你|做得到|前进|慢慢来|一步/],["playful",/嘿嘿|嗯哼|可爱|好嘛|啦/],["tenderness",/温柔|接住|陪你|不用逞强/]
];

const storeKey="kurisu-emotion-learning-v2";
function learned(){try{return JSON.parse(localStorage.getItem(storeKey)||"{}")}catch{return{}}}
function validPhrase(value){return typeof value==="string"&&value.length>=2&&value.length<=24&&!/https?:|@|\d{5,}|电话|地址|密码|身份证/.test(value)}
export function learnEmotionState(category,label,detail){if(!banks[category]||!validPhrase(label)||!validPhrase(detail))return false;const data=learned(),list=data[category]||[];if(!list.some(x=>x[0]===label)){list.push([label,detail]);data[category]=list.slice(-20);localStorage.setItem(storeKey,JSON.stringify(data))}return true}
export function inferEmotion(text="",hint=""){if(banks[hint])return hint;for(const [name,pattern] of rules)if(pattern.test(text))return name;return"calm"}
export function emotionState(text="",hint=""){
  const category=inferEmotion(text,hint),custom=learned()[category]||[],options=[...banks[category],...custom];
  const recent=JSON.parse(sessionStorage.getItem("kurisu-recent-states-v2")||"[]");let candidates=options.filter(x=>!recent.includes(x[0]));if(!candidates.length)candidates=options;
  const pair=candidates[Math.floor(Math.random()*candidates.length)];sessionStorage.setItem("kurisu-recent-states-v2",JSON.stringify([...recent,pair[0]].slice(-8)));
  return{category,label:pair[0],detail:pair[1]};
}

export const emotionCategories=Object.keys(banks);
