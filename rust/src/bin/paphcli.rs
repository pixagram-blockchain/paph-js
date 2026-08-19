//! Parity harness.
//!   hash:    [b"H"][u32 w][u32 h][RGBA]  ->  [u32 t1len][u32 t2len][t1][t2]
//!   compare: [b"C"][u32 a1][u32 a2][u32 b1][u32 b2][wires] -> [u32 len][json]
//!   golden:  [b"G"] -> the SPEC-004 §20 golden vectors as JSON (see golden.rs)
//!   v4:      [b"V"][u32 a1][u32 a2][u32 b1][u32 b2][wires] -> compare_v4 JSON
//!            (Config::default + CAL-001-PROVISIONAL; the parity4 surface)
use paph3::compare::compare;
use paph3::config::Config;
use paph3::keypoints::{pattern, RotCache};
use paph3::wire::hash;
use std::io::{Read, Write};

fn rd(b: &[u8], o: usize) -> usize {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) as usize
}

fn json_esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn main() {
    let mut buf = Vec::new();
    std::io::stdin().read_to_end(&mut buf).unwrap();
    let out = std::io::stdout();
    let mut o = out.lock();
    let cfg = Config::default();
    match buf[0] {
        b'V' => {
            let (a1, a2, b1, b2) = (rd(&buf, 1), rd(&buf, 5), rd(&buf, 9), rd(&buf, 13));
            let mut p = 17usize;
            let at1 = &buf[p..p + a1];
            p += a1;
            let at2 = &buf[p..p + a2];
            p += a2;
            let bt1 = &buf[p..p + b1];
            p += b1;
            let bt2 = &buf[p..p + b2];
            let prof = paph3::calibration::Profile::cal001();
            let r = paph3::v4::compare_v4(
                at1, if a2 > 0 { Some(at2) } else { None },
                bt1, if b2 > 0 { Some(bt2) } else { None },
                &cfg, &prof, None, None,
            );
            o.write_all(paph3::v4::to_json_v4(&r).as_bytes()).unwrap();
        }
        b'W' => {
            // SPEC-004.1: same framing as 'V', comparator 41 under cal003.
            let (a1, a2, b1, b2) = (rd(&buf, 1), rd(&buf, 5), rd(&buf, 9), rd(&buf, 13));
            let mut p = 17usize;
            let at1 = &buf[p..p + a1];
            p += a1;
            let at2 = &buf[p..p + a2];
            p += a2;
            let bt1 = &buf[p..p + b1];
            p += b1;
            let bt2 = &buf[p..p + b2];
            let prof = paph3::calibration::Profile::cal003();
            let r = paph3::v41::compare_v41(
                at1, if a2 > 0 { Some(at2) } else { None },
                bt1, if b2 > 0 { Some(bt2) } else { None },
                &cfg, &prof, None, None,
            );
            o.write_all(paph3::v41::to_json_v41(&r).as_bytes()).unwrap();
        }
        b'G' => {
            o.write_all(paph3::golden::golden_json().as_bytes()).unwrap();
        }
        b'H' => {
            let (w, h) = (rd(&buf, 1), rd(&buf, 5));
            let rot = RotCache::new(&pattern());
            let fp = hash(&buf[9..9 + w * h * 4], w, h, &cfg, &rot);
            o.write_all(&(fp.t1.len() as u32).to_le_bytes()).unwrap();
            o.write_all(&(fp.t2.len() as u32).to_le_bytes()).unwrap();
            o.write_all(&fp.t1).unwrap();
            o.write_all(&fp.t2).unwrap();
        }
        b'C' => {
            let (a1, a2, b1, b2) = (rd(&buf, 1), rd(&buf, 5), rd(&buf, 9), rd(&buf, 13));
            let mut p = 17usize;
            let at1 = &buf[p..p + a1];
            p += a1;
            let at2 = &buf[p..p + a2];
            p += a2;
            let bt1 = &buf[p..p + b1];
            p += b1;
            let bt2 = &buf[p..p + b2];
            let v = compare(at1, Some(at2), bt1, Some(bt2), &cfg).unwrap();
            let mut ch = String::new();
            for (i, (n, c)) in v.channels.iter().enumerate() {
                if i > 0 {
                    ch.push(',');
                }
                ch.push_str(&format!(
                    "\"{}\":{{\"value\":{},\"raw\":{},\"control\":{},\"measurable\":{},\"note\":\"{}\"}}",
                    n, c.value, c.raw, c.control, c.measurable, json_esc(&c.note)
                ));
            }
            let j = format!(
                "{{\"verdict\":\"{}\",\"class\":\"{}\",\"structural\":{},\"geometric\":{},\"weighted\":{},\"gate\":{},\
                 \"identical\":{},\"structuralCertifiable\":{},\"swapped\":{},\"inliers\":{},\"chanceInliers\":{},\
                 \"accepted\":{},\"hypothesis\":\"{}\",\"dihedral\":{},\"inverted\":{},\"palette\":\"{}\",\
                 \"basis\":[{}],\"abstained\":[{}],\"channels\":{{{}}}}}",
                v.verdict, json_esc(&v.class), v.structural, v.geometric, v.weighted, v.gate,
                v.identical, v.structural_certifiable, v.swapped, v.geo.inliers, v.geo.chance,
                v.geo.accepted, v.geo.hypothesis,
                match v.dihedral { Some(d) => format!("\"{}\"", d), None => "null".into() },
                v.inverted, v.palette_relation,
                v.basis.iter().map(|s| format!("\"{}\"", s)).collect::<Vec<_>>().join(","),
                v.abstained.iter().map(|s| format!("\"{}\"", s)).collect::<Vec<_>>().join(","),
                ch
            );
            o.write_all(&(j.len() as u32).to_le_bytes()).unwrap();
            o.write_all(j.as_bytes()).unwrap();
        }
        _ => panic!("bad mode byte"),
    }
}
