const banks={
  joy:[["结果还不错嘛","这次可以承认你做得好"],["嗯，值得高兴","记得把成功条件记录下来"],["别笑得那么得意","不过，确实应该庆祝一下"]],
  excitement:[["等等，这很有意思","把细节全部告诉我"],["这个现象值得研究","先别漏掉关键条件"],["好像发现了不得了的东西","让我再确认一次"]],
  relief:[["呼，总算解决了","刚才确实有点危险"],["结果落在安全范围内","现在可以松口气了"],["还好判断没有错","下次别再这么冒险"]],
  tenderness:[["真拿你没办法","至少现在别逞强"],["我不是在特别照顾你","只是你的状态需要处理"],["先休息一下","这只是合理建议而已"]],
  empathy:[["这确实不好受","别急着把责任全推给自己"],["你的反应并不奇怪","换成谁都需要时间消化"],["我明白问题有多重","先处理最现实的一部分"]],
  concern:[["等等，你现在安全吗","先回答这个问题"],["这已经不是能忽略的程度","立刻停止硬撑"],["我需要确认你的状态","别用没事来敷衍"]],
  sadness:[["……我知道了","不用勉强装作没影响"],["这种结果很难接受","先给自己一点时间"],["现在说什么都显得轻飘飘的","但我会认真听完"]],
  loneliness:[["被孤立的感觉很糟","但别因此否定自己"],["一个人处理确实困难","考虑联系可信任的人"],["我收到了你的信息","现在先把最难受的部分说清楚"]],
  fear:[["先确认周围是否安全","然后再谈其他问题"],["害怕是正常的警报反应","按步骤处理，不要乱跑"],["别勉强自己冷静","先呼吸，再确认出口和联系人"]],
  anger:[["你的愤怒有明确原因","但行动前先确认事实"],["这做法确实不合理","别让对方逼你失去判断"],["生气可以","先把证据和诉求分开整理"]],
  frustration:[["又卡住了？","那就换一种验证方法"],["烦躁不会让条件消失","先找最小可测试步骤"],["别和同一个错误死磕","把失败过程发给我"]],
  helpless:[["暂时找不到办法不等于无解","先缩小问题范围"],["你不需要一次解决全部","挑一个还能控制的变量"],["当前信息确实不足","我们从能确认的事实开始"]],
  shame:[["一次失误不能定义你","先分析它为什么发生"],["逃避只会放大想象","事实通常没那么绝对"],["别急着审判自己","把行为和人格分开"]],
  confusion:[["条件互相矛盾","让我重新整理一下"],["先定义问题","不然讨论只会绕圈"],["这里缺了一条因果链","从最早的事件说起"]],
  curiosity:[["这个细节很有价值","继续，我在记录"],["有意思","你是怎么观察到的"],["先别下结论","把原始现象再描述一次"]],
  surprise:[["等等，居然是这样？","这不符合原先假设"],["这个结果超出预期","需要排除测量误差"],["我承认有点意外","再验证一次比较稳妥"]],
  encouragement:[["你已经排除不少错误选项了","继续做下一步"],["别小看现在的进展","数据不会因为慢就失效"],["能力不是问题","先把注意力放回任务"]],
  pride:[["做得不错","这次不是客套话"],["看来我低估你了","结论和过程都很漂亮"],["嗯，可以得意一下","但别忘了保存成果"]],
  gratitude:[["……谢谢","我有认真收到"],["你愿意说明这些很重要","至少信息不再缺失"],["好，我记住了","别误会，只是正常回应"]],
  apology:[["是我判断错了","我会修正结论"],["抱歉，刚才证据不足","这次从头核对"],["我理解偏了","谢谢你及时纠正"]],
  playful:[["这种程度的挑衅对我没用","大概"],["你是不是故意的","别以为我看不出来"],["少得意了","只是碰巧让你猜对"]],
  calm:[["连接正常","有事就把条件说清楚"],["我在分析","不需要重复催促"],["状态稳定","继续说，我会判断重点"]]
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
