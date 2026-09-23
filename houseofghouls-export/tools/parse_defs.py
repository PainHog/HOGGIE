#!/usr/bin/env python3
"""Extract House of Ghouls class/race/skill definitions to JSON (read-only)."""
import os, re, json, glob

SRC="/home/user/HOGGIE/HouseOfGhouls"
OUT="/home/user/HOGGIE/houseofghouls-export/content"

CLASS_ORDER=["Mage","Cleric","Thief","Warrior","Thug","Druid","Ranger","Monk",
 "Diabolist","Conjurer","Jester","Shaman","Champion","Bishop","Rogue","Archmagi"]
# Tier (remort) classes and the base classes that advance into them (systems-spec.md §2.4).
# Tier classes are NOT creation choices — they're reached via `advancetier` (the tier system).
TIER_OF={"Champion":["Warrior","Ranger","Monk"], "Bishop":["Diabolist","Cleric","Shaman"],
         "Rogue":["Thief","Thug","Jester"], "Archmagi":["Mage","Druid","Conjurer"]}
RACE_ORDER=["Human","Elf","Dwarf","Halfling","Pixie","Minotaur","Half-Ogre","Half-Orc",
 "Half-Troll","Half-Elf","Gith","Drow","Sea-Elf","Lizardman","Gnome","Ghoul","Goblin",
 "Wolfen","Shuri","Gulran","Zephyr","Jinn","Ahpock"]
ATTR=["none","strength","intelligence","wisdom","dexterity","constitution","charisma","luck"]

# RIS bitvector -> damage/effect class (mud.h RIS_FIRE..RIS_PARALYSIS, BV00..BV21).
# Same table the mob extractor uses, so race RIS decodes identically to mobs.
RIS_FLAGS=["fire","cold","electricity","energy","blunt","pierce","slash","acid","poison",
 "drain","sleep","charm","hold","nonmagic","plus1","plus2","plus3","plus4","plus5","plus6",
 "magic","paralysis"]

def read(p): return open(p,encoding="latin-1").read()

def decode_bits(bits, table):
    """Bitvector int -> list of set flag names (unknown high bits are ignored, never guessed)."""
    if not isinstance(bits,int): return []
    return [name for i,name in enumerate(table) if bits & (1<<i)]

def _norm(s):
    """Normalize a race name / help keyword for matching: uppercase, alnum only."""
    return re.sub(r'[^A-Z0-9]','',s.upper())

def _add(d, norm_keys, text):
    for k in norm_keys:
        if k and k not in d: d[k]=text

def build_help():
    """Index the MUD's own help entries by type -> {normalized keyword: prose}.
    Primary: the Lua help files (typed: race/class/skill/spell). Fallback: the classic .are help
    files (help.are/help2.are), untyped, folded into an 'any' bucket and matched by exact name.
    Lua wins on overlap. `text = function() … end` (dynamic/category) entries are skipped."""
    H={"race":{}, "class":{}, "skill":{}, "spell":{}, "any":{}}
    for fn in ("lua/help_all.lua","lua/help_race.lua","lua/help_class.lua","lua/help_skill.lua","lua/help_spell.lua"):
        path=os.path.join(SRC,fn)
        if not os.path.exists(path): continue
        txt=read(path)
        for m in re.finditer(r'keywords\s*=\s*\{([^}]*)\}.*?h?type\s*=\s*"([^"]*)".*?text\s*=\s*\[\[(.*?)\]\]',txt,re.S):
            kws,htype,body=m.group(1),m.group(2),m.group(3)
            text=body.strip()
            if not text: continue
            norm=[_norm(p) for tok in re.findall(r'"([^"]*)"',kws) for p in tok.split()]
            if htype in H: _add(H[htype],norm,text)
            _add(H["any"],norm,text)
    for fn in ("area/help.are","area/help2.are"):
        path=os.path.join(SRC,fn)
        if not os.path.exists(path): continue
        lines=read(path).splitlines(); i=0
        while i<len(lines):
            m=re.match(r'^\s*(-?\d+)\s+(\S.*?)~\s*$',lines[i])
            if m:
                kws=m.group(2); body=[]; i+=1
                while i<len(lines) and lines[i].strip()!="~":
                    body.append(lines[i]); i+=1
                text="\n".join(body).strip()
                if text: _add(H["any"],[_norm(p) for p in kws.split()],text)
            i+=1
    return H

def help_for(H, kind, name):
    k=_norm(name)
    return H.get(kind,{}).get(k) or H["any"].get(k) or ""

def parse_class(path):
    lines=read(path).splitlines()
    c={"file":os.path.basename(path),"skills":[],"titles":[]}
    i=0
    def kv(line):
        m=re.match(r'^(\w+)\s+(.*)$',line)
        return (m.group(1),m.group(2).rstrip()) if m else (None,None)
    while i<len(lines):
        ln=lines[i].rstrip()
        if ln.startswith("Skill "):
            m=re.match(r"Skill\s+'([^']+)'\s+(\d+)\s+(\d+)",ln)
            if m: c["skills"].append({"skill":m.group(1),"level":int(m.group(2)),"adept":int(m.group(3))})
        elif ln.startswith("Title"):
            male=lines[i+1].rstrip("~ \t") if i+1<len(lines) else ""
            female=lines[i+2].rstrip("~ \t") if i+2<len(lines) else ""
            c["titles"].append({"level":len(c["titles"]),"male":male.rstrip('~'),"female":female.rstrip('~')})
            i+=2
        elif ln=="End":
            break
        else:
            k,v=kv(ln)
            if k=="Name": c["name"]=v.rstrip('~').strip()
            elif k=="Class": c["id"]=int(v)
            elif k=="AttrPrime": c["attr_prime"]=ATTR[int(v)] if int(v)<len(ATTR) else v
            elif k=="AttrSecond": c["attr_second"]=ATTR[int(v)] if int(v)<len(ATTR) else v
            elif k=="AttrTertiary": c["attr_tertiary"]=ATTR[int(v)] if int(v)<len(ATTR) else v
            elif k=="Weapon": c["starting_weapon_vnum"]=int(v)
            elif k=="Guild": c["guild_room_vnum"]=int(v)
            elif k=="Skilladept": c["skill_adept_cap"]=int(v)
            elif k=="Thac0base": c["thac0_base"]=int(v)
            elif k=="Thac0mod": c["thac0_mod"]=int(v)
            elif k=="Hpmin": c["hp_gain_min"]=int(v)
            elif k=="Hpmax": c["hp_gain_max"]=int(v)
            elif k=="Mana": c["mana_gain"]=int(v)
            elif k=="Expbase": c["exp_base_per_level"]=int(v)
            elif k in ("Affected","Resist","Suscept"): c[k.lower()]=int(v) if v.strip().lstrip('-').isdigit() else v
        i+=1
    c["skill_count"]=len(c["skills"])
    c["title_count"]=len(c["titles"])
    return c

def parse_race(path):
    r={"file":os.path.basename(path),"where_name_count":0}
    for ln in read(path).splitlines():
        ln=ln.rstrip()
        if ln.startswith("WhereName"): r["where_name_count"]+=1; continue
        if ln=="End": break
        m=re.match(r'^(\w+)\s+(.*)$',ln)
        if not m: continue
        k,v=m.group(1),m.group(2).rstrip()
        vs=v.rstrip('~').strip()
        num = int(vs) if re.fullmatch(r'-?\d+',vs) else None
        km={"Name":"name","Race":"id","Classes":"allowed_classes_bits","Str_Plus":"str_plus",
            "Dex_Plus":"dex_plus","Wis_Plus":"wis_plus","Int_Plus":"int_plus","Con_Plus":"con_plus",
            "Cha_Plus":"cha_plus","Lck_Plus":"lck_plus","Hit":"hit_plus","Mana":"mana_plus",
            "Affected":"affected_bits","Resist":"resist_bits","Suscept":"suscept_bits",
            "Language":"language_bits","Align":"align","Min_Align":"min_align","Max_Align":"max_align",
            "AC_Plus":"ac_plus","Exp_Mult":"exp_mult_pct","Attacks":"attacks_bits","Defenses":"defenses_bits",
            "Height":"height","Weight":"weight","Hunger_Mod":"hunger_mod","Thirst_mod":"thirst_mod",
            "Mana_Regen":"mana_regen","HP_Regen":"hp_regen","Race_Recall":"race_recall_vnum"}
        key=km.get(k,k.lower())
        if key=="name": r["name"]=vs
        else: r[key]= num if num is not None else vs
    # 'Classes' is class_restriction: a SET bit means that class is FORBIDDEN for the race
    if "allowed_classes_bits" in r:
        bits=r.pop("allowed_classes_bits")
        r["class_restriction_bits"]=bits
        r["allowed_classes"]=[CLASS_ORDER[i] for i in range(len(CLASS_ORDER)) if not (bits & (1<<i))]
        r["restricted_classes"]=[CLASS_ORDER[i] for i in range(len(CLASS_ORDER)) if (bits & (1<<i))]
    return r

def parse_skills(path):
    txt=read(path)
    blocks=re.split(r'^#SKILL\s*$',txt,flags=re.M)
    skills=[]
    for b in blocks:
        if "Name" not in b: continue
        s={}
        for ln in b.splitlines():
            m=re.match(r'^(\w+)\s+(.*)$',ln)
            if not m: continue
            k,v=m.group(1),m.group(2).rstrip()
            vs=v.rstrip('~').strip()
            if k=="Name": s["name"]=vs
            elif k=="Type": s["type"]=vs
            elif k=="Slot": s["slot"]=int(vs) if vs.lstrip('-').isdigit() else vs
            elif k=="Mana": s["mana"]=int(vs) if vs.lstrip('-').isdigit() else vs
            elif k=="Rounds": s["beats"]=int(vs) if vs.lstrip('-').isdigit() else vs
            elif k=="Minlevel": s["min_level"]=int(vs) if vs.lstrip('-').isdigit() else vs
            elif k=="Minpos": s["min_position"]=int(vs) if vs.lstrip('-').isdigit() else vs
            elif k=="Target": s["target"]=int(vs) if vs.lstrip('-').isdigit() else vs
            elif k=="Code": s["code_fn"]=vs
            elif k=="Dammsg": s["damage_noun"]=vs
            elif k=="Flags": s["flags"]=int(vs) if vs.lstrip('-').isdigit() else vs
            elif k=="Info": s["info"]=int(vs) if vs.lstrip('-').isdigit() else vs
        if "name" in s: skills.append(s)
    return skills

def main():
    classes=[parse_class(p) for p in sorted(glob.glob(f"{SRC}/classes/*.class"))]
    classes.sort(key=lambda c:c.get("id",999))
    races=[parse_race(p) for p in sorted(glob.glob(f"{SRC}/races/*.race"))]
    races.sort(key=lambda r:r.get("id",999))
    # Resolve duplicate race ids: the source declares Deep-Gnome and Gnome both as Race 14, which
    # would make one unselectable (raceId is the selection/persistence key). Keep the canonical race
    # (the one in RACE_ORDER) on the shared id and bump the other(s) to fresh ids.
    seen={}; next_id=max(r.get("id",0) for r in races)+1; reassigned=[]
    for r in sorted(races, key=lambda r:(r.get("id",999), 0 if r.get("name") in RACE_ORDER else 1, r.get("name",""))):
        rid=r.get("id")
        if rid in seen:
            r["id"]=next_id; reassigned.append(f"{r.get('name')} {rid}->{next_id}"); next_id+=1
        seen[r["id"]]=r.get("name")
    races.sort(key=lambda r:r.get("id",999))
    if reassigned: print("race id collisions resolved:", "; ".join(reassigned))
    skills=parse_skills(f"{SRC}/system/skills.dat")
    # Index the MUD's help prose once, then attach descriptions to every entity.
    H=build_help()
    # Races: decode RIS bitvectors to damage-type arrays (matching mobs) + help prose.
    no_help=[]
    for r in races:
        r["resistant"]=decode_bits(r.get("resist_bits"),RIS_FLAGS)
        r["susceptible"]=decode_bits(r.get("suscept_bits"),RIS_FLAGS)
        r["description"]=help_for(H,"race",r.get("name",""))
        if not r["description"]: no_help.append(r.get("name"))
    print("races with help text:",len(races)-len(no_help),"/",len(races),
          "| no source help:",", ".join(no_help) or "none")
    # Classes: help prose + tier classification (tier classes aren't creation choices).
    base_for={b:t for t,bs in TIER_OF.items() for b in bs}
    c_no_help=[]
    for c in classes:
        nm=c.get("name","")
        c["description"]=help_for(H,"class",nm)
        c["tiered"]=nm in TIER_OF
        if nm in TIER_OF: c["tier_of"]=TIER_OF[nm]           # tier class <- these base classes
        elif nm in base_for: c["advances_to"]=base_for[nm]   # base class -> this tier class
        if not c["description"]: c_no_help.append(nm)
    print("classes with help text:",len(classes)-len(c_no_help),"/",len(classes),
          "| no help:",", ".join(c_no_help) or "none")
    # Skills/spells: real help prose (the numeric `info` field is NOT a description).
    s_have=0
    for s in skills:
        kind="spell" if s.get("type")=="Spell" else "skill"
        s["description"]=help_for(H,kind,s.get("name",""))
        if s["description"]: s_have+=1
    print(f"skills/spells with help text: {s_have} / {len(skills)}")
    json.dump(classes,open(f"{OUT}/classes.json","w"),indent=1,ensure_ascii=False)
    json.dump(races,open(f"{OUT}/races.json","w"),indent=1,ensure_ascii=False)
    json.dump(skills,open(f"{OUT}/skills.json","w"),indent=1,ensure_ascii=False)
    # progression summary: per class, level->title
    prog=[]
    for c in classes:
        prog.append({"class":c.get("name"),"id":c.get("id"),
                     "max_title_level":c.get("title_count",0)-1,
                     "hp_per_level":[c.get("hp_gain_min"),c.get("hp_gain_max")],
                     "mana_per_level":c.get("mana_gain"),
                     "exp_base":c.get("exp_base_per_level"),
                     "thac0":[c.get("thac0_base"),c.get("thac0_mod")],
                     "skills_learnable":c.get("skill_count")})
    json.dump(prog,open(f"{OUT}/progression.json","w"),indent=1,ensure_ascii=False)
    tc={}
    for s in skills: tc[s.get("type","?")]=tc.get(s.get("type","?"),0)+1
    print("classes",len(classes),"races",len(races),"skills",len(skills),"by type",tc)
    for c in classes: print(f"  {c.get('id'):2} {c.get('name'):10} skills={c.get('skill_count')} titles={c.get('title_count')} hp={c.get('hp_gain_min')}-{c.get('hp_gain_max')} exp={c.get('exp_base_per_level')}")

if __name__=="__main__": main()
