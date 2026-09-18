#!/usr/bin/env python3
"""
House of Ghouls content extractor.
Reproduces the SMAUG area-file reader semantics (verified against src/db.c) to
pull the OWNER'S original world content out of the legacy engine into JSON.
Read-only on the source tree. No engine source is copied; only data is read.
"""
import os, sys, json, glob, re

SRC = "/home/user/HOGGIE/HouseOfGhouls"
OUT = "/home/user/HOGGIE/houseofghouls-export/content"

# ---- Flag vocabularies (from src/build.c, the game's own labels) ----
EX_FLAGS = ["isdoor","closed","locked","secret","swim","pickproof","fly","climb",
 "dig","eatkey","nopassdoor","hidden","passage","portal","r1","r2","can_climb",
 "can_enter","can_leave","auto","noflee","searchable","bashed","bashproof","nomob",
 "window","can_look","isbolt","bolted"]
SEC_FLAGS = ["inside","city","field","forest","hills","mountain","water_swim",
 "water_noswim","underwater","air","desert","somewhere","oceanfloor","underground",
 "lava","swamp","boat","r2","r3","r4","r5","r6","r7","r8","r9","r10","r11","r12",
 "r13","r14","r15","r16"]
R_FLAGS = ["dark","death","nomob","indoors","healing","mental","chaotic","nomagic",
 "tunnel","private","safe","solitary","petshop","norecall","donation","nodropall",
 "silence","logspeech","nodrop","folstoreroom","nosummon","noastral","teleport",
 "teleshowdesc","nofloor","nosupplicate","arena","norun","locker","bloodroom",
 "prototype","dnd"]
O_FLAGS = ["glow","hum","dark","loyal","evil","invis","magic","nodrop","bless",
 "antigood","antievil","antineutral","noremove","inventory","antimage","antithief",
 "antiwarrior","anticleric","organic","metal","donation","clanobject","clancorpse",
 "hidden","poisoned","covering","deathrot","buried","prototype","nolocate","groundrot",
 "lootable","ided","good","quest","noburn","2handed","noquest","golem","conjurer",
 "enchanted","no_junk","random","pet_eq"]
W_FLAGS = ["take","head","eyes","ears","face","neck","body","arms","wrist","hands",
 "finger","about","back","waist","legs","ankle","feet","wield","_dual_","shield",
 "hold","pride","aura","r6","r7","r8","r9","r10","r11","r12","r13"]
AREA_FLAGS = ["nopkill","freekill","noteleport","spelllimit"]
O_TYPES = ["none","light","scroll","wand","staff","weapon","_fireweapon","_missile",
 "treasure","armor","potion","worn","furniture","trash","_oldtrap","container","_note",
 "drinkcon","key","food","money","pen","boat","corpse","corpse_pc","fountain","pill",
 "blood","bloodstain","scraps","pipe","herbcon","herb","incense","fire","book","switch",
 "lever","pullchain","button","dial","rune","runepouch","match","trap","map","portal",
 "paper","tinder","lockpick","spike","disease","oil","fuel","piece","_empty2",
 "missileweapon","projectile","quiver","shovel","salve","cook","keyring","comp",
 "artweapon","artarmor","arttreasure","artworn","artlight","mix","chance"]
A_TYPES = ["none","strength","dexterity","intelligence","wisdom","constitution","sex",
 "class","level","age","height","weight","mana","hit","move","gold","experience","armor",
 "hitroll","damroll","save_damage","save_rod","save_para","save_breath","save_spell",
 "charisma","affected","resistant","immune","susceptible","weaponspell","luck","backstab",
 "pick","track","steal","sneak","hide","palm","detrap","dodge","peek","scan","gouge",
 "search","mount","disarm","kick","parry","bash","stun","punch","climb","grip","scribe",
 "brew","wearspell","removespell","emotion","mentalstate","stripsn","remove","dig","full",
 "thirst","drunk","blood","recurringspell","contagious","xaffected","odor","roomflag",
 "sectortype","roomlight","televnum","teledelay","camouflage","ambush","spiritshield",
 "spelldam","jump","wait"]
A_FLAGS = ["blind","invisible","detect_evil","detect_invis","detect_magic","detect_hidden",
 "imp_invis","sanctuary","faerie_fire","infrared","curse","corrupt","poison","protect",
 "_paralysis","sneak","hide","sleep","charm","flying","pass_door","floating","truesight",
 "detect_traps","scrying","fireshield","shockshield","detect_good","iceshield","possess",
 "berserk","aqua_breath","recurringspell","empowered","tongues","balanced","auralink",
 "unused5","mighty","camouflage","demonsight","bound","mute"]
ACT_FLAGS = ["npc","sentinel","scavenger","healer","banker","aggressive","stayarea","wimpy",
 "pet","innkeeper","guildmaster","immortal","bribable","polymorphed","undertaker","guardian",
 "running","trainer","mountable","mounted","scholar","secretive","noquest","mobinvis",
 "noassist","astralblock","pacifist","noattack","equipped","boat","aquatic","questmaster",
 "aggressive_low","aggressive_mid","aggressive_high","no_corpse","plant"]
ATTACK_FLAGS = ["bite","claws","tail","sting","punch","kick","trip","bash","stun","gouge",
 "backstab","drain","firebreath","frostbreath","acidbreath","lightnbreath","gasbreath",
 "poison","unused1","unused2","blindness","causeserious","earthquake","causecritical","curse",
 "flamestrike","harm","fireball","colorspray","weaken","spiralblast","ambush"]
DEFENSE_FLAGS = ["parry","dodge","heal","curelight","cureserious","curecritical","dispelmagic",
 "dispelevil","sanctuary","fireshield","shockshield","unused1","unused2","unused3","teleport",
 "unused4","unused5","unused6","unused7","disarm","iceshield","grip","truesight","unused8","unused9"]
RIS_FLAGS = ["fire","cold","electricity","energy","blunt","pierce","slash","acid","poison",
 "drain","sleep","charm","hold","nonmagic","plus1","plus2","plus3","plus4","plus5","plus6",
 "magic","paralysis"]
DIR_NAME = ["north","east","south","west","up","down","northeast","northwest","southeast",
 "southwest","somewhere"]
POS_NAME = ["dead","mortal","incap","stunned","sleeping","berserk","resting","aggressive",
 "sitting","fighting","defensive","evasive","standing","mounted","shove","drag"]
SEX_NAME = ["neutral","male","female"]

def decode(bits, table):
    out=[]
    for i,name in enumerate(table):
        if bits & (1<<i):
            out.append(name)
    # bits beyond table
    return out

def decode_ext(words, table):
    """Decode a SMAUG extended bitvector (list of 32-bit words) against a label table.
    Flag index for word w, bit b is (w*32 + b)."""
    out=[]
    for w,word in enumerate(words):
        for b in range(32):
            if word & (1<<b):
                idx=w*32+b
                out.append(table[idx] if 0<=idx<len(table) else f'bit{idx}')
    return out

def pos_name(n):
    return POS_NAME[n] if 0<=n<len(POS_NAME) else str(n)

class Reader:
    def __init__(self, text):
        self.s=text; self.i=0; self.n=len(text)
    def eof(self):
        return self.i>=self.n
    def _skipspace(self):
        while self.i<self.n and self.s[self.i].isspace():
            self.i+=1
    def peek_nonspace(self):
        j=self.i
        while j<self.n and self.s[j].isspace(): j+=1
        return self.s[j] if j<self.n else ''
    def letter(self):
        self._skipspace()
        if self.i>=self.n: return ''
        c=self.s[self.i]; self.i+=1; return c
    def string(self):
        # skip leading whitespace, read until '~'
        self._skipspace()
        start=self.i
        while self.i<self.n and self.s[self.i]!='~':
            self.i+=1
        val=self.s[start:self.i]
        if self.i<self.n and self.s[self.i]=='~':
            self.i+=1
        return val
    def number(self):
        self._skipspace()
        sign=1
        if self.i<self.n and self.s[self.i] in '+-':
            if self.s[self.i]=='-': sign=-1
            self.i+=1
        num=0; got=False
        while self.i<self.n and self.s[self.i].isdigit():
            num=num*10+int(self.s[self.i]); self.i+=1; got=True
        num*=sign
        # pipe-OR continuation (bitvector)
        if self.i<self.n and self.s[self.i]=='|':
            self.i+=1
            num+=self.number()
        return num if got or True else 0
    def bitvector(self):
        # SMAUG extended bitvector: one or more 32-bit words joined by '&'
        words=[]
        while True:
            words.append(self.number())
            if self.i<self.n and self.s[self.i]=='&':
                self.i+=1
                continue
            break
        return words
    def word(self):
        self._skipspace()
        if self.i<self.n and self.s[self.i]=="'":
            self.i+=1; start=self.i
            while self.i<self.n and self.s[self.i]!="'":
                self.i+=1
            val=self.s[start:self.i]
            if self.i<self.n: self.i+=1
            return val
        start=self.i
        while self.i<self.n and not self.s[self.i].isspace():
            self.i+=1
        return self.s[start:self.i]
    def line(self):
        # skip leading whitespace incl newlines, then read to end of line
        self._skipspace()
        start=self.i
        while self.i<self.n and self.s[self.i]!='\n':
            self.i+=1
        val=self.s[start:self.i]
        if self.i<self.n: self.i+=1
        return val.rstrip('\r')
    def nums_from_line(self, count):
        ln=self.line()
        toks=ln.replace('|',' ').split()
        vals=[]
        for t in toks:
            try: vals.append(int(t))
            except: pass
        while len(vals)<count: vals.append(0)
        return vals[:count]
    def raw_to_eol(self):
        # read to end of CURRENT line and consume trailing newline(s); no leading skip
        while self.i<self.n and self.s[self.i] not in '\n\r':
            self.i+=1
        while self.i<self.n and self.s[self.i] in '\n\r':
            self.i+=1
    def skip_mudprogs(self):
        # Faithfully skip a SMAUG mud/obj/room prog block.
        # Structure per prog: '>' <word type> <string arglist>~ <eol> <string comlist>~ <eol>
        # then a letter: '>' = another prog, '|' = end of block.
        self._skipspace()
        if self.i>=self.n or self.s[self.i]!='>':
            return
        self.i+=1  # consume '>'
        guard=0
        while True:
            guard+=1
            if guard>100000: return
            self.word()        # prog type (e.g. death_prog)
            self.string()      # arglist (to ~)
            self.raw_to_eol()
            self.string()      # comlist / program body (to ~) - may contain '|'
            self.raw_to_eol()
            c=self.letter()
            if c=='>':
                continue
            elif c=='|':
                self.raw_to_eol()
                return
            else:
                # desync guard: unget and stop
                if self.i>0: self.i-=1
                return

def parse_mob(r):
    m={}
    m['vnum']=r.number()
    if m['vnum']==0: return None
    m['keywords']=r.string().strip()
    m['short_desc']=r.string().strip()
    m['long_desc']=r.string().strip()
    m['description']=r.string().strip()
    act=r.bitvector(); aff=r.bitvector(); m['alignment']=r.number()
    m['act_flags']=decode_ext(act,ACT_FLAGS)
    m['affect_flags']=decode_ext(aff,A_FLAGS)
    letter=r.letter()
    m['level']=r.number()
    m['thac0']=r.number()
    m['ac']=r.number()
    hnd=r.number(); r.letter(); hsd=r.number(); r.letter(); hp=r.number()
    m['hp_dice']=f"{hnd}d{hsd}+{hp}"
    dnd=r.number(); r.letter(); dsd=r.number(); r.letter(); dp=r.number()
    m['dam_dice']=f"{dnd}d{dsd}+{dp}"
    m['gold']=r.number(); m['exp']=r.number()
    pos=r.number(); pos = pos-100 if pos>=100 else pos
    dpos=r.number(); dpos = dpos-100 if dpos>=100 else dpos
    m['position']=pos_name(pos)
    m['default_position']=pos_name(dpos)
    sx=r.number()
    m['sex']=SEX_NAME[sx] if 0<=sx<len(SEX_NAME) else str(sx)
    if letter=='C':
        m['stats']={k:r.number() for k in ['str','int','wis','dex','con','cha','lck']}
        m['saves']={k:r.number() for k in ['save_damage','save_wand','save_para_petri','save_breath','save_spell_staff']}
        race,cls,height,weight,speaks,speaking,numattacks = r.nums_from_line(7)
        m['race_id']=race; m['class_id']=cls; m['height']=height; m['weight']=weight
        m['numattacks']=numattacks
        hitroll,damroll,xflags,resist,immune,suscept,attacks,defenses = r.nums_from_line(8)
        m['hitroll']=hitroll; m['damroll']=damroll
        m['resistant']=decode(resist,RIS_FLAGS)
        m['immune']=decode(immune,RIS_FLAGS)
        m['susceptible']=decode(suscept,RIS_FLAGS)
        m['special_attacks']=decode(attacks,ATTACK_FLAGS)
        m['special_defenses']=decode(defenses,DEFENSE_FLAGS)
    else:
        m['simple_mob']=True
    # optional mudprogs
    if r.peek_nonspace()=='>':
        m['has_mobprogs']=True
        r.skip_mudprogs()
    return m

def parse_obj(r, version=1):
    o={}
    o['vnum']=r.number()
    if o['vnum']==0: return None
    o['keywords']=r.string().strip()
    o['short_desc']=r.string().strip()
    o['description']=r.string().strip()
    o['action_desc']=r.string().strip()
    itype=r.number()
    o['item_type']=O_TYPES[itype] if 0<=itype<len(O_TYPES) else str(itype)
    extra=r.bitvector()
    o['extra_flags']=decode_ext(extra,O_FLAGS)
    wf=r.nums_from_line(2)
    o['wear_flags']=decode(wf[0],W_FLAGS)
    o['values']=r.nums_from_line(15)
    o['weight']=r.number(); o['cost']=r.number(); r.number()  # rent unused
    # area_version==1: spell/skill names stored as words for magical items
    if version==1:
        spells=[]
        if itype in (2,10,26):      # scroll, potion, pill  -> 3 spell words
            spells=[r.word(),r.word(),r.word()]
        elif itype in (3,4):        # wand, staff           -> 1 spell word
            spells=[r.word()]
        elif itype==60:             # salve                 -> 2 spell words
            spells=[r.word(),r.word()]
        spells=[s for s in spells if s and s.upper()!='NONE']
        if spells: o['spells']=spells
    affects=[]; edescs=[]
    while True:
        c=r.peek_nonspace()
        if c=='A':
            r.letter()
            loc=r.number(); mod=r.number()
            aname=A_TYPES[loc] if 0<=loc<len(A_TYPES) else str(loc)
            affects.append({'apply':aname,'modifier':mod})
        elif c=='E':
            r.letter()
            kw=r.string().strip(); d=r.string().strip()
            edescs.append({'keyword':kw})
        elif c=='>':
            o['has_objprogs']=True
            r.skip_mudprogs()
        else:
            break
    if affects: o['affects']=affects
    if edescs: o['extra_desc_keywords']=[e['keyword'] for e in edescs]
    return o

def parse_room(r):
    rm={}
    rm['vnum']=r.number()
    if rm['vnum']==0: return None
    rm['name']=r.string().strip()
    rm['description']=r.string().strip()
    vals=r.nums_from_line(6)
    rm['room_flags']=decode(vals[1],R_FLAGS)
    sect=vals[2]
    rm['sector']=SEC_FLAGS[sect] if 0<=sect<len(SEC_FLAGS) else str(sect)
    if vals[3] or vals[4]:
        rm['teleport']={'delay':vals[3],'to_vnum':vals[4]}
    if vals[5]: rm['tunnel']=vals[5]
    exits=[]; edescs=[]
    while True:
        c=r.letter()
        if c=='' or c=='S':
            break
        if c=='D':
            door=r.number()
            desc=r.string().strip(); kw=r.string().strip()
            ev=r.nums_from_line(6)
            locks=ev[0]
            ex={'dir':DIR_NAME[door] if 0<=door<len(DIR_NAME) else str(door),
                'to_vnum':ev[2]}
            if ev[1] and ev[1]>0: ex['key_vnum']=ev[1]
            flags=[]
            if locks==1: flags=['door']
            elif locks==2: flags=['door','pickproof']
            elif locks>2: flags=decode(locks,EX_FLAGS)
            if flags: ex['flags']=flags
            if kw: ex['keyword']=kw
            exits.append(ex)
        elif c=='E':
            kw=r.string().strip(); d=r.string().strip()
            edescs.append(kw)
        elif c=='M':
            r.number(); r.number(); r.number(); r.letter()  # map data
        elif c=='>':
            r.i-=1  # unget
            rm['has_roomprogs']=True
            r.skip_mudprogs()
        else:
            # unknown; bail to avoid infinite loop
            break
    if exits: rm['exits']=exits
    if edescs: rm['extra_desc_keywords']=edescs
    return rm

VALID_RESET_CMDS=set('MOPGEDTHRB')
def parse_resets(r):
    resets=[]
    while True:
        c=r.letter()
        if c=='' or c=='S': break
        if c=='*':
            r.line(); continue
        if c not in VALID_RESET_CMDS:
            break  # engine bails on unknown reset command
        extra=r.number(); a1=r.number(); a2=r.number()
        a3 = 0 if c in ('G','R') else r.number()
        r.line()
        resets.append({'cmd':c,'extra':extra,'arg1':a1,'arg2':a2,'arg3':a3})
    return resets

SECTION_RE=re.compile(r'^#([A-Z][A-Z0-9]*)', re.M)

def parse_area(path):
    with open(path,'r',encoding='latin-1') as f:
        text=f.read()
    area={'file':os.path.basename(path)}
    # header fields via regex (they're simple one-liners / ~ strings)
    def field(tag):
        m=re.search(r'^#'+tag+r'\s+(.*?)~', text, re.M|re.S)
        return m.group(1).strip() if m else None
    nm=re.search(r'^#AREA\s+(.*?)~', text, re.M|re.S)
    area['name']=nm.group(1).strip() if nm else None
    au=re.search(r'^#AUTHOR\s+(.*?)~', text, re.M|re.S)
    area['author']=au.group(1).strip() if au else None
    vs=re.search(r'^#VERSION\s+(\d+)', text, re.M)
    area['version']=int(vs.group(1)) if vs else 0
    rg=re.search(r'^#RANGES\s+([\d\s]+)', text, re.M)
    if rg:
        parts=rg.group(1).split()
        if len(parts)>=4:
            area['level_range']={'soft_low':int(parts[0]),'soft_high':int(parts[1]),
                                 'hard_low':int(parts[2]),'hard_high':int(parts[3])}
    fl=re.search(r'^#FLAGS\s+([\d\s]+)', text, re.M)
    if fl:
        p=fl.group(1).split()
        if p: area['area_flags']=decode(int(p[0]),AREA_FLAGS)
    rmsg=re.search(r'^#RESETMSG\s+(.*?)~', text, re.M|re.S)
    if rmsg: area['reset_msg']=rmsg.group(1).strip()

    mobs=[]; objs=[]; rooms=[]; resets=[]
    # MOBILES
    mm=re.search(r'^#MOBILES', text, re.M)
    if mm:
        r=Reader(text[mm.end():])
        while True:
            c=r.letter()
            if c!='#': break
            if r.peek_nonspace()=='0':
                r.number(); break
            m=parse_mob(r)
            if m is None: break
            m['area']=area['file']; mobs.append(m)
    om=re.search(r'^#OBJECTS', text, re.M)
    if om:
        r=Reader(text[om.end():])
        while True:
            c=r.letter()
            if c!='#': break
            if r.peek_nonspace()=='0':
                r.number(); break
            o=parse_obj(r, area.get('version',1))
            if o is None: break
            o['area']=area['file']; objs.append(o)
    rmc=re.search(r'^#ROOMS', text, re.M)
    if rmc:
        r=Reader(text[rmc.end():])
        while True:
            c=r.letter()
            if c!='#': break
            if r.peek_nonspace()=='0':
                r.number(); break
            rm=parse_room(r)
            if rm is None: break
            rm['area']=area['file']; rooms.append(rm)
    rs=re.search(r'^#RESETS', text, re.M)
    if rs:
        r=Reader(text[rs.end():])
        resets=parse_resets(r)
    area['counts']={'mobs':len(mobs),'objects':len(objs),'rooms':len(rooms),'resets':len(resets)}
    # vnum span
    allv=[x['vnum'] for x in rooms]+[x['vnum'] for x in mobs]+[x['vnum'] for x in objs]
    if allv:
        area['vnum_range']=[min(allv),max(allv)]
    return area, mobs, objs, rooms, resets

def main():
    files=sorted(glob.glob(os.path.join(SRC,'area','*.are')))
    areas=[]; all_mobs=[]; all_objs=[]; all_rooms=[]; spawns=[]
    errors=[]
    for path in files:
        try:
            area,mobs,objs,rooms,resets=parse_area(path)
            areas.append(area)
            all_mobs+=mobs; all_objs+=objs; all_rooms+=rooms
            # turn resets into self-documenting spawn records tied to area
            WEARLOC=["light","head","eyes","ears","face","neck1","neck2","body","arms",
              "wrist1","wrist2","hands","finger1","finger2","about","back","waist","legs",
              "ankle1","ankle2","feet","wield","dual","shield","hold","pride1","pride2","aura"]
            for rr in resets:
                c=rr['cmd']; a1=rr['arg1']; a2=rr['arg2']; a3=rr['arg3']
                rec={'area':area['file'],'type':c}
                if c=='M': rec.update(kind='spawn_mob', mob_vnum=a1, max_in_world=a2, room_vnum=a3)
                elif c=='O': rec.update(kind='place_object', obj_vnum=a1, room_vnum=a3)
                elif c=='G': rec.update(kind='give_to_mob', obj_vnum=a1)
                elif c=='E': rec.update(kind='equip_mob', obj_vnum=a1,
                                        wear_loc=WEARLOC[a3] if 0<=a3<len(WEARLOC) else a3)
                elif c=='P': rec.update(kind='put_in_container', obj_vnum=a1, container_vnum=a3)
                elif c=='D': rec.update(kind='door_state', room_vnum=a1, door=a2, state=a3)
                else: rec.update(kind='other', arg1=a1, arg2=a2, arg3=a3)
                spawns.append(rec)
        except Exception as e:
            errors.append({'file':os.path.basename(path),'error':str(e)})
            sys.stderr.write(f"ERR {path}: {e}\n")
    os.makedirs(OUT,exist_ok=True)
    def dump(name,obj):
        with open(os.path.join(OUT,name),'w') as f:
            json.dump(obj,f,indent=1,ensure_ascii=False)
    dump('areas.json',areas)
    dump('rooms.json',all_rooms)
    dump('mobs.json',all_mobs)
    dump('objects.json',all_objs)
    dump('resets.json',spawns)
    stats={'areas':len(areas),'rooms':len(all_rooms),'mobs':len(all_mobs),
           'objects':len(all_objs),'resets':len(spawns),'errors':errors}
    dump('_extract_stats.json',stats)
    print(json.dumps(stats['errors'],indent=1))
    print("AREAS",len(areas),"ROOMS",len(all_rooms),"MOBS",len(all_mobs),
          "OBJS",len(all_objs),"RESETS",len(spawns))

if __name__=='__main__':
    main()
