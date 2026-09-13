import {dashboardData as data,getRegistered,getWage,geographyLabel,ageBandLabel} from './dashboard-data';
import {getResidentEmploymentIndustry} from './resident-employment-industry';
import {difference,estimate,aggregate,rounded} from './aws-roa-model';
import type {RoaSelection,analyzeRoa} from './aws-roa-analysis';

type Fact={id:string;district:string;metric:string;label:string;category:string;period:string;value:number;unit:string;universe:string;url:string;sourceName:string};
export type RoaContext={version:string;reviewedAt:string;facts:Fact[]};
export type LocalEvidence={text:string;period:string;url?:string;source:string};
export type RoaDirection={title:string;evidence:LocalEvidence[];question:string;action:string;followup:string;delivery:string};
const n=(v:number)=>v.toLocaleString('zh-TW',{maximumFractionDigits:2});
const sign=(v:number)=>`${v>0?'+':''}${n(v)}`;
const youthSource='已發布戶籍人口資料（畫面相同年齡、性別）';
const bridge='https://www.traffic.ntpc.gov.tw/home.jsp?act=be4f48068b2b0031&dataserno=2279ff80dc5ae80a8c65e085cafd26d7&id=54fa46e9e522dde4';
const school='https://www.maintenance.ntpc.gov.tw/home.jsp?act=be4f48068b2b0031&dataserno=eed3eaba08be4de15c173d647ee9d892&id=b2dfefc09cf046f2';
const career='https://www.youth.ntpc.gov.tw/youth/ch/app/artwebsite/view?id=169&module=artwebsite&serno=5a223970-c464-4a53-81f3-c3277f5fff30';
const family='https://www.gov.tw/News_Content_26_778871';

export function buildRoaDirection(s:RoaSelection,a:ReturnType<typeof analyzeRoa>,context:RoaContext|null):RoaDirection|null {
  if(!a.current&&s.topic!=='service_sites')return null;
  const key=a.classification.stableKey;
  const scopeName=`${s.place}${ageBandLabel(s.age)}${s.sex==='合計'?'・男女合計':`・${s.sex}`}`;
  const direction:RoaDirection={title:'',evidence:[],question:'',action:'',followup:'',delivery:key==='11'?'先選一條服務路徑，整理可執行的小型改善提案。':key==='10'?'先以預約、定時或跨區合作方式試行，再看是否需要固定服務。':key==='01'?'先調整現有服務內容、入口或時段，保留原有服務基礎。':key==='00'?'保留基本服務；收到具體需求後，再調整內容與時段。':'先針對可確認的數值提出選項；不依尚未確定的象限決定投入規模。'};
  const add=(text:string,period:string,source=youthSource,url?:string)=>direction.evidence.push({text,period,source,url});
  const local=context?.facts.filter(f=>f.district===s.place)??[];
  const pop=getRegistered(s.year,s.place,s.age,s.sex),prev=getRegistered(s.year-1,s.place,s.age,s.sex);
  const popChange=difference(estimate(pop?.population),estimate(prev?.population),true);
  const facilities=data.service.facilities.filter(f=>f.district===s.place);
  const facilityText=()=>{
    if(facilities.length)add(`${s.place}青年據點名冊列有${facilities.length}處：${facilities.slice(0,2).map(f=>`${f.name}（${f.address}）`).join('、')}。`,`${data.service.snapshotYear}年快照`,'青年局據點名冊',facilities[0].sourceUrl);
    else add(`${data.service.snapshotYear}年青年局名冊未列${s.place}據點。`,`${data.service.snapshotYear}年快照`,'青年局據點名冊','https://www.youth.ntpc.gov.tw/youth/ch/app/folder/59');
  };
  const topicLabel=s.topic==='education'?`${s.category}占比`:s.topic==='marriage'?`${s.marital}占比`:s.topic==='education_marriage'?`${s.category}人口中的${s.marital}占比`:s.topic==='salary'?s.salary:s.topic==='salary_gap'?'平均數高於中位數的相對差距':s.topic==='industry'?'前五大行業集中度':s.topic==='employment'?'就業人口比率':s.topic==='unemployment'?'失業率':null;
  if(topicLabel&&a.current){
    const unit=s.topic==='salary'?'萬元／年':'%';
    add(`${s.year}年${scopeName}，${topicLabel}${n(a.current.value)}${unit}${a.baseline?`；${s.scope==='city'?'指定歷年平均':'29區中位數'}${n(a.baseline.value)}${unit}`:''}。`,`${s.year}年`,a.current.origin);
    if(a.growth)add(`與${s.year-1}年相比${sign(a.growth.value)}${s.topic==='salary'?'%':'個百分點'}（點估計差距）。`,`${s.year-1}–${s.year}年`,a.current.origin);
  }
  if(['population','density','service_sites'].includes(s.topic)){
    if(pop)add(`${s.year}年${scopeName}共${n(pop.population)}人${prev?`；比${s.year-1}年${sign(pop.population-prev.population)}人${popChange?`（${sign(popChange.value)}%）`:''}`:''}。`,prev?`${s.year-1}–${s.year}年`:`${s.year}年`);
    if(s.scope==='district'){
      const cityChange=difference(estimate(getRegistered(s.year,'新北市',s.age,s.sex)?.population),estimate(getRegistered(s.year-1,'新北市',s.age,s.sex)?.population),true);
      if(cityChange)add(`同年齡、同性別的新北市人口年增率${sign(cityChange.value)}%。`,`${s.year-1}–${s.year}年`);
      const bands=['18-24','25-29','30-35'] as const;
      if(s.age==='18-35'){
        const changes=bands.map(age=>({age,now:getRegistered(s.year,s.place,age,s.sex),before:getRegistered(s.year-1,s.place,age,s.sex)})).filter(x=>x.now&&x.before).map(x=>({age:x.age,value:x.now!.population-x.before!.population})).sort((a,b)=>b.value-a.value);
        if(changes.length===3)add(`分齡變化：${changes.map(x=>`${ageBandLabel(x.age)}${sign(x.value)}人`).join('；')}。`,`${s.year-1}–${s.year}年`);
      }
      if(s.topic==='density'&&pop?.populationDensityPerKm2!=null)add(`青年平均密度${n(pop.populationDensityPerKm2)}人／平方公里${a.baseline?`；29區同條件中位數${n(a.baseline.value)}人／平方公里`:''}。`,`${s.year}年`);
      if(s.topic==='service_sites')facilityText();
      if(s.place==='淡水區'&&s.topic!=='service_sites'){
        direction.title='先整理淡水青年住宅到轉乘點的日常路徑';
        add('交通局公告淡水端微型轉運站整合輕軌、公車與 YouBike，並規劃988等新增路線。','115年5月8日公告（另期環境背景）','新北市交通局',bridge);
        add('天生國小淡海路72巷人行道已改善445公尺，113年8月完工。','113年完工；114年9月公告','新北市養護工程處',school);
        direction.question='新增或現有青年在住家、轉運站與周邊公共空間之間，是否還有候車資訊不清、步行不連續或過街不便的路段？';
        direction.action='可由區公所、交通局與青年局選一條青年常用路徑，合併標示轉乘資訊、候車點與安全過街位置；接續已改善路段，優先提出小範圍動線及標示改善。';
        direction.followup='先確認實際使用路線、候車時間、步道斷點與路口通行狀況。已完工路段不重複列為工程缺口；30–35歲人口增加本身不代表家長或通勤人數增加。';
      }else{
        const densities=data.geographies.filter(g=>g.name!=='新北市').map(g=>estimate(getRegistered(s.year,geographyLabel(g.name),s.age,s.sex)?.populationDensityPerKm2));
        const denseBase=aggregate(densities,'median');
        const dense=pop?.populationDensityPerKm2!=null&&denseBase?pop.populationDensityPerKm2>=denseBase.value:null;
        const grows=popChange?popChange.value>0:null;
        direction.title=s.topic==='service_sites'?`把${s.place}現有服務位置與青年使用路徑接起來`:dense?`先整理${s.place}既有公共空間的青年使用動線`:`先了解${s.place}青年到服務地點的往返路程`;
        direction.question=grows?`所選族群增加後，${dense?'既有車站與公共空間的出入口、候車位置':'住家到公共運輸或服務地點的銜接'}是否有需要調整的地方？`:`在所選族群${grows===false?'持平或減少':'尚無完整年度比較'}的情況下，哪些既有服務仍是青年常用、卻不易抵達或不合使用時段？`;
        direction.action=dense?`由${s.place}區公所與青年局在現有公共空間安排青年需求登記，集中處理路線指引、等候空間及服務時段；不先預設新增建物。`:`可由${s.place}區公所提供定時服務或跨區預約入口，把青年常用服務集中在容易轉乘的位置；有明確往返障礙時，再討論接駁調整。`;
        direction.followup='用實際往返時間、常用時段、服務位置及青年反映的路段，選出一處可先改善的地方。平均密度不代表個別街廓的擁擠程度。';
        if(s.topic!=='service_sites')facilityText();
      }
    }else{
      direction.title='依真正增加的年齡層，調整全市青年服務配置';
      direction.question='不同年齡層的人數變化，是否與現有課程、諮詢及活動使用者的年齡組成一致？';
      direction.action='先把全市既有青年服務按18–24、25–29、30–35歲整理，提供可選的夜間、假日或線上服務，將使用者回饋最多的時段問題列入調整。';
      direction.followup='用服務報名的年齡、實際到場及偏好時段，確認要調整哪一項服務，而非用人口變化直接指定增加經費。';
    }
  }else if(s.topic==='marriage'||s.topic==='education_marriage'){
    const selected=s.topic==='education_marriage'?`${s.category}、${s.marital}`:s.marital;
    direction.title=s.marital==='未婚'?`為${s.place}${selected}青年提供自選的交流入口`:s.marital==='有偶'?`整理${s.place}${selected}青年的家庭生活支援入口`:s.marital==='喪偶'?`讓${s.place}喪偶青年容易找到陪伴與諮詢`:`讓${s.place}${selected}青年取得生活調適與諮詢`;
    direction.question=s.marital==='未婚'?'有興趣參與的青年，較需要興趣交流、同儕連結，還是其他生活資訊？':s.marital==='有偶'?'有需求的青年是否容易找到家庭協調、照顧資訊與可配合的諮詢時段？':s.marital==='喪偶'?'有需要的人是否知道陪伴、哀傷支持及生活協助的申請入口？':'面對關係改變的青年，是否需要更容易預約的生活調適、法律資訊與家庭諮詢？';
    direction.action=s.marital==='未婚'?`可在${s.place}公共空間辦理自願參加的${s.topic==='education_marriage'&&['大學','研究所'].includes(s.category)?'專題分享與興趣交流':'興趣活動'}，報名時讓青年自選交流主題；不以結婚率作活動目標。`:s.marital==='有偶'?`可在${s.place}整合家庭諮詢及照顧資訊的預約入口，讓有需要者選擇夜間或線上諮詢。`:s.marital==='喪偶'?`可在${s.place}設置自願、個別預約的哀傷陪伴轉介入口，協助有需要者找到心理支持及生活事務協助。`:`可在${s.place}提供不標籤身分的個別預約入口，串接家庭服務、法律資訊、租屋資訊及心理支持，讓參與者自行選擇需要的協助。`;
    direction.followup='先了解自願使用者想解決的生活問題及偏好方式。婚姻占比描述結構，不等於個人困境；同一學歷內的比例不代表所有該學歷青年都需要服務。';
    if(s.marital!=='未婚')add('我的E政府整理婚姻諮詢、離婚程序與相關協助入口，可作服務轉介參考。','現行資源頁；2026年9月查閱','我的E政府',family);
    if(s.scope==='district'&&s.place==='淡水區'&&s.marital!=='未婚')add('淡水區公所設有特殊境遇家庭及弱勢家庭兒少協助窗口。','現行窗口；2026年9月查閱','淡水區公所服務電話一覽表','https://www.tamsui.ntpc.gov.tw/home.jsp?id=adbb16502b55a98a');
  }else if(s.topic==='education'){
    const early=['國中及以下','高中職'].includes(s.category);
    direction.title=`依${s.place}${s.category}青年的學習背景安排${early?'入門技能與進修資訊':'專題實作與跨領域交流'}`;
    direction.question=`對自願參與的${s.category}青年，現有${early?'技能入門、證照與進修':'專業實作、轉職探索與跨領域'}服務的內容、地點及時段是否合適？`;
    direction.action=early?`可在${s.place}用短時段實作搭配進修資訊，提供不需先備技能的體驗，再由參與者自選後續課程。`:`可針對${s.place}願意參與的青年，安排作品交流、跨領域專題或業師諮詢；報名時先收集主題，不預設所有人都在找工作。`;
    direction.followup='用青年自選主題、完成作品與後續進修意願決定內容。教育比例本身不代表就業障礙或能力不足。';
    add('青職基地已有線上及實體職涯諮詢、進修培力及履歷服務，可合作轉介。','2026年9月查閱','新北市青年局',career);
  }else if(s.topic==='industry'){
    const top=getResidentEmploymentIndustry(s.year,s.sex,s.age).filter(r=>Number.isFinite(r.sharePct)).sort((a,b)=>b.sharePct-a.sharePct).slice(0,3);
    if(top.length)add(`此族群較主要的行業：${top.map(r=>`${r.industry} ${n(r.sharePct)}%`).join('、')}。`,`${s.year}年`,'居住於新北市的青年就業者行業模型估計');
    direction.title='從主要行業出發，提供可以跨行業使用的技能體驗';
    direction.question='集中在主要行業的青年，是否希望了解相鄰職務、進修技能或其他行業的工作內容？';
    direction.action='依圖中主要行業邀請在職者分享實際工作，提供短期職務體驗及可轉移技能課程；讓青年比較不同工作內容，而非直接推薦轉職。';
    direction.followup='先收集想了解的職務、參與者在職狀態及技能需求。行業集中不等於缺工或工作不穩定。';
    add('青職基地提供職涯探索、諮詢及進修培力服務，可作跨行業探索的合作入口。','2026年9月查閱','新北市青年局',career);
  }else if(s.topic==='employment'||s.topic==='unemployment'){
    direction.title=s.topic==='unemployment'?'讓想找工作的青年更快接上求職協助':'讓想進入或重返工作的青年找到合適的入口';
    direction.question=s.topic==='unemployment'?'正在找工作的青年，最常卡在職缺資訊、履歷面試、技能條件，還是可配合的工作時段？':'就學、準備考試、照顧家人或其他未就業狀況中，哪些青年有就業意願而需要協助？';
    direction.action='可採一次需求確認加後續預約，讓青年選擇履歷面試、職涯諮詢、技能體驗或彈性時段職缺資訊，再對應安排服務。';
    direction.followup='紀錄自願使用者的就業意願、服務選擇及後續求職進展；不把未就業全部當作失業。';
    add('青職基地已有職涯適性、履歷健診及個別諮詢，可沿用現有服務分流。','2026年9月查閱','新北市青年局',career);
  }else{
    const w=getWage(s.year,s.age),mean=w?.metrics['全年總薪資平均數'],median=w?.metrics['全年總薪資中位數'];
    if(mean!=null&&median!=null)add(`${ageBandLabel(s.age)}平均數${n(mean)}萬元／年，中位數${n(median)}萬元／年，差額${n(rounded(mean-median))}萬元／年。`,`${s.year}年`,'新北市工作場所口徑青年薪資模型估計');
    direction.title=s.topic==='salary_gap'?'把薪資典型水準與較高薪職務的差別講清楚':'提供看得懂的薪資比較與職務成長路徑';
    direction.question='青年比較工作時，是否能同時理解全年總薪資、經常性月薪、工時與工作內容的差別？';
    direction.action='可整理匿名職缺範例，將薪資組成、工時、所需技能並排呈現，搭配勞動權益諮詢與技能成長資訊；先協助做工作選擇，再討論課程或企業合作。';
    direction.followup='薪資以工作場所為母體，不與行政區租金直接計算青年負擔率。相對差距也不能換算成低薪青年人數。';
  }
  const rent=local.find(r=>r.metric==='RENT_MEDIAN'&&r.category===(s.age==='18-24'?'獨立套房':'整戶（層）'));
  if(rent&&(['population','density'].includes(s.topic)||(['marriage','education_marriage'].includes(s.topic)&&s.marital==='離婚或終止結婚')))add(`${s.place}${rent.category}租金中位數${n(rent.value)}${rent.unit}（租金補貼有效租約樣本）。`,`${rent.period}期（另期住房背景，非青年專屬）`,rent.sourceName,'https://moisagis.moi.gov.tw/rent/index.html');
  const birth=local.find(r=>r.metric==='CRUDE_BIRTH_RATE'&&r.period===String(s.year));
  const birthPrev=local.find(r=>r.metric==='CRUDE_BIRTH_RATE'&&r.period===String(s.year-1));
  if(birth&&birthPrev&&['population','density'].includes(s.topic)){
    add(`${s.place}全年齡粗出生率由${birthPrev.period}年${n(birthPrev.value)}‰變為${birth.period}年${n(birth.value)}‰。`,`${birthPrev.period}–${birth.period}年（全年齡背景）`,birth.sourceName,birth.url);
    if(birth.value<=birthPrev.value)direction.followup+=' 同期全年齡粗出生率未增加，育兒需求不能只由青年人口增加推定。';
  }
  return direction.title?direction:null;
}
