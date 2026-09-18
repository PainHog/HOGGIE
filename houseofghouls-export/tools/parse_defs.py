#!/usr/bin/env python3
"""Extract House of Ghouls class/race/skill definitions to JSON (read-only)."""
import os, re, json, glob

SRC="/home/user/HOGGIE/HouseOfGhouls"
OUT="/home/user/HOGGIE/houseofghouls-export/content"

CLASS_ORDER=["Mage","Cleric","Thief","Warrior","Thug","Druid","Ranger","Monk",
 "Diabolist","Conjurer","Jester","Shaman","Champion","Bishop","Rogue","Archmagi"]
RACE_ORDER=["Human","Elf","Dwarf","Halfling","Pixie","Minotaur","Half-Ogre","Half-Orc",
 "Half-Troll","Half-Elf","Gith","Drow","Sea-Elf","Lizardman","Gnome","Ghoul","Goblin",
 "Wolfen","Shuri","Gulran","Zephyr","Jinn","Ahpock"]
ATTR=["none","strength","intelligence","wisdom","dexterity","constitution","charisma","luck"]

def read(p): return open(p,encoding="latin-1").read()

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
    skills=parse_skills(f"{SRC}/system/skills.dat")
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
