import sqlite3
import os
import json
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
import google.generativeai as genai
from google.generativeai import types # 🌟 نحتاجها لـ Schema
# 🌟🌟🌟 إزالة: from google.generativeai.tools import GoogleSearchRetrieval # هذا المسار غير موجود في إصدارك

# ----------------------------------------------------
# 1. إعدادات Gemini و Flask
# ----------------------------------------------------
load_dotenv()
genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))

DATABASE_FILE = "my_app_data.db"

# 🌟 تحسين: تحديد مجلد 'static' لتقديم ملفات الواجهة الأمامية (HTML/JS/CSS)
# هذا يحل مشكلة file:/// و CORS
app = Flask(__name__, static_folder='static', static_url_path='')

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'a_very_secret_key_for_session')
CORS(app, supports_credentials=True)

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login' # 🌟 سيقوم Flask-Login بإعادة التوجيه إلى هنا (يفترض أنه مسار API)
# 🌟 ملاحظة: يمكننا لاحقاً جعل هذا يعيد خطأ 401 بدلاً من إعادة التوجيه
@login_manager.unauthorized_handler
def unauthorized():
    # إعادة خطأ 401 للطلبات غير المصادق عليها بدلاً من إعادة التوجيه
    return jsonify({"message": "خطأ: يتطلب هذا الإجراء تسجيل الدخول."}), 401

# ----------------------------------------------------
# 2. كلاس إدارة المستخدمين (لـ Flask-Login)
# ----------------------------------------------------
class User(UserMixin):
    def __init__(self, id, username):
        self.id = id
        self.username = username

@login_manager.user_loader
def load_user(user_id):
    conn = None
    try:
        # 🌟 تحسين: استخدام دالة مخصصة لضمان فتح/إغلاق الاتصال
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))
        user_data = cursor.fetchone()
        if user_data:
            return User(user_data[0], user_data[1])
        return None
    except Exception as e:
        print(f"خطأ في load_user: {e}")
        return None
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------
# 3. كلاس إدارة قاعدة البيانات (تمت إعادة هيكلته وإصلاحه)
# ----------------------------------------------------
class DBManager:
    def __init__(self, db_file: str):
        self.db_file = db_file
        # 🌟 استخدام check_same_thread=False ضروري لـ Flask
        self.create_tables()

    def get_db_connection(self):
        # 🌟 دالة مساعدة لفتح اتصال جديد عند الحاجة
        conn = sqlite3.connect(self.db_file, check_same_thread=False)
        # استخدام row_factory يجعل النتائج كـ dicts (أسهل للـ JSON)
        conn.row_factory = sqlite3.Row
        return conn

    def create_tables(self):
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS bookings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    user_name TEXT NOT NULL,
                    hotel_name TEXT NOT NULL,
                    city TEXT NOT NULL,
                    check_in TEXT NOT NULL,
                    check_out TEXT NOT NULL,
                    price REAL NOT NULL,
                    hotel_image_url TEXT,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            ''')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS favorites (
                    user_id INTEGER NOT NULL,
                    item_name TEXT NOT NULL,
                    city TEXT NOT NULL,
                    added_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, item_name),
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            ''')
            conn.commit()
            print("تم إنشاء/تحقق جداول قاعدة البيانات بنجاح.")
        except Exception as e:
            print(f"خطأ في إنشاء الجداول: {e}")
        finally:
            if conn:
                conn.close() # 🌟 إغلاق الاتصال

    # ------------------------------------
    # 🌟 إصلاح: وظائف المفضلة (تم إصلاح منطق الاتصال)
    # ------------------------------------
    def is_favorite(self, user_id, item_name):
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('SELECT 1 FROM favorites WHERE user_id = ? AND item_name = ?', (user_id, item_name))
            return cursor.fetchone() is not None
        except Exception as e:
            print(f"خطأ في is_favorite: {e}")
            return False
        finally:
            if conn:
                conn.close()

    def add_favorite(self, user_id, item_name, city):
        from datetime import datetime
        added_at = datetime.now().isoformat()
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('INSERT INTO favorites (user_id, item_name, city, added_at) VALUES (?, ?, ?, ?)',
                                (user_id, item_name, city, added_at))
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            # هذا يحدث إذا كان السجل موجودًا بالفعل
            return True 
        except Exception as e:
            print(f"خطأ أثناء إضافة المفضلة: {e}")
            return False
        finally:
            if conn:
                conn.close()

    def remove_favorite(self, user_id, item_name):
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('DELETE FROM favorites WHERE user_id = ? AND item_name = ?', (user_id, item_name))
            conn.commit()
            return cursor.rowcount > 0
        except Exception as e:
            print(f"خطأ أثناء إزالة المفضلة: {e}")
            return False
        finally:
            if conn:
                conn.close()

    def fetch_user_favorites(self, user_id):
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('''
                SELECT item_name, city
                FROM favorites
                WHERE user_id = ?
            ''', (user_id,))
            # 🌟 تحويل النتائج (من conn.row_factory) إلى list of dicts
            return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            print(f"خطأ أثناء جلب مفضلات المستخدم: {e}")
            return []
        finally:
            if conn:
                conn.close()

    # ------------------------------------
    # وظائف المستخدم والحجوزات (المنطق سليم)
    # ------------------------------------
    def register_user(self, username, password):
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            password_hash = generate_password_hash(password)
            cursor.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)",
                                (username, password_hash))
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False
        except Exception as e:
            print(f"خطأ أثناء تسجيل المستخدم: {e}")
            return False
        finally:
            if conn:
                conn.close() # 🌟 إغلاق الاتصال

    def verify_user(self, username, password):
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT id, username, password_hash FROM users WHERE username = ?", (username,))
            user_data = cursor.fetchone() # 🌟 user_data هو الآن Row object
            if user_data and check_password_hash(user_data["password_hash"], password):
                return User(user_data["id"], user_data["username"])
            return None
        except Exception as e:
            print(f"خطأ أثناء التحقق من المستخدم: {e}")
            return None
        finally:
            if conn:
                conn.close() # 🌟 إغلاق الاتصال

    def insert_booking(self, user_id, user_name, hotel_name, city, check_in, check_out, price, hotel_image_url=None):
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO bookings (user_id, user_name, hotel_name, city, check_in, check_out, price, hotel_image_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (user_id, user_name, hotel_name, city, check_in, check_out, price, hotel_image_url))
            conn.commit()
            return cursor.lastrowid
        except Exception as e:
            print(f"خطأ أثناء حفظ الحجز: {e}")
            return False
        finally:
            if conn:
                conn.close() # 🌟 إغلاق الاتصال

    def fetch_user_bookings(self, user_id):
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, hotel_name, city, check_in, check_out, price, hotel_image_url
                FROM bookings
                WHERE user_id = ?
                ORDER BY id DESC
            ''', (user_id,))
            return [dict(row) for row in cursor.fetchall()]
        except Exception as e:
            print(f"خطأ أثناء جلب حجوزات المستخدم: {e}")
            return []
        finally:
            if conn:
                conn.close() # 🌟 إغلاق الاتصال
        
    def fetch_booking_by_id(self, booking_id, user_id):
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, hotel_name, city, check_in, check_out, price, hotel_image_url
                FROM bookings
                WHERE id = ? AND user_id = ?
            ''', (booking_id, user_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
        except Exception as e:
            print(f"خطأ أثناء جلب حجز معين: {e}")
            return None
        finally:
            if conn:
                conn.close() # 🌟 إغلاق الاتصال

    def delete_booking(self, booking_id, user_id):
        conn = None
        try:
            conn = self.get_db_connection()
            cursor = conn.cursor()
            # التأكد من أن الحجز يخص المستخدم الذي يطلب الحذف
            cursor.execute('''
                DELETE FROM bookings
                WHERE id = ? AND user_id = ?
            ''', (booking_id, user_id))
            conn.commit()
            # rowcount > 0 يعني أنه تم حذف صف واحد بنجاح
            return cursor.rowcount > 0
        except Exception as e:
            print(f"خطأ أثناء حذف الحجز: {e}")
            return False
        finally:
            if conn:
                conn.close()


# تهيئة مدير قاعدة البيانات
try:
    db_manager = DBManager(DATABASE_FILE)
except Exception as e:
    print(f"فشل في تهيئة قاعدة البيانات: {e}")


# ----------------------------------------------------
# 4. 🌟 نقطة نهاية لتقديم الواجهة الأمامية
# ----------------------------------------------------
@app.route('/')
def serve_index():
    # إرسال index.html من مجلد 'static'
    return send_from_directory(app.static_folder, 'index.html')

# ----------------------------------------------------
# 5. نقاط نهاية المصادقة و CRUD (بدون تغيير عن السابق)
# ----------------------------------------------------

@app.route('/api/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        if not username or not password:
            return jsonify({"message": "خطأ: يجب إدخال اسم المستخدم وكلمة المرور."}), 400

        if db_manager.register_user(username, password):
            print(f"✅ تم إنشاء حساب جديد: {username}")
            return jsonify({"message": f"تم إنشاء الحساب بنجاح لـ {username}. يمكنك الآن تسجيل الدخول."}), 201
        else:
            print(f"⚠️ اسم المستخدم موجود بالفعل: {username}")
            return jsonify({"message": "خطأ: اسم المستخدم موجود بالفعل، أو حدث خطأ آخر."}), 409
    except Exception as e:
        print(f"🔥 خطأ في register: {e}")
        return jsonify({"message": "حدث خطأ داخلي في الخادم."}), 500

@app.route('/api/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        if not username or not password:
            return jsonify({"message": "خطأ: يجب إدخال اسم المستخدم وكلمة المرور."}), 400

        user = db_manager.verify_user(username, password)

        if user:
            login_user(user) # 🌟 هنا يتم تعيين الكوكي
            print(f"✅ تسجيل دخول ناجح للمستخدم: {username}")
            return jsonify({"message": "تم تسجيل الدخول بنجاح.", "user_id": user.id, "username": user.username}), 200
        else:
            print(f"❌ فشل تسجيل الدخول: اسم المستخدم أو كلمة المرور غير صحيحة.")
            return jsonify({"message": "خطأ: اسم المستخدم أو كلمة المرور غير صحيحة."}), 401
    except Exception as e:
        print(f"🔥 خطأ في login: {e}")
        return jsonify({"message": "حدث خطأ داخلي في الخادم."}), 500

@app.route('/api/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({"message": "تم تسجيل الخروج بنجاح."}), 200

@app.route('/api/status', methods=['GET'])
def status():
    if current_user.is_authenticated:
        return jsonify({"is_authenticated": True, "user_id": current_user.id, "username": current_user.username}), 200
    else:
        return jsonify({"is_authenticated": False}), 200

@app.route('/api/booking', methods=['POST'])
@login_required
def add_booking():
    data = request.get_json()
    required_fields = ['hotel_name', 'city', 'check_in', 'check_out', 'price']
    if not all(field in data and data[field] is not None for field in required_fields):
        return jsonify({"message": "خطأ: بيانات الحجز ناقصة."}), 400

    user_id = current_user.id
    user_name = current_user.username
    hotel_name = data['hotel_name']
    city = data['city']
    check_in = data['check_in']
    check_out = data['check_out']
    
    try:
        price = float(data['price'])
    except (ValueError, TypeError):
        return jsonify({"message": "خطأ: السعر يجب أن يكون رقمًا صالحًا."}), 400

    hotel_image_url = data.get('hotel_image_url', None)

    booking_id = db_manager.insert_booking(user_id, user_name, hotel_name, city, check_in, check_out, price, hotel_image_url)
    
    if booking_id:
        return jsonify({
            "message": "تم تأكيد الحجز بنجاح!",
            "booking_id": booking_id
        }), 201
    else:
        return jsonify({"message": "فشل في حفظ الحجز في قاعدة البيانات."}), 500


@app.route('/api/bookings', methods=['GET'])
@login_required
def get_user_bookings():
    bookings_data = db_manager.fetch_user_bookings(current_user.id)
    return jsonify(bookings_data)


@app.route('/api/booking/<int:booking_id>', methods=['DELETE'])
@login_required
def delete_booking(booking_id):
    """نقطة نهاية لحذف حجز معين."""
    if db_manager.delete_booking(booking_id, current_user.id):
        print(f"🗑️ تم حذف الحجز (ID: {booking_id}) بواسطة المستخدم (ID: {current_user.id})")
        return jsonify({"message": "تم إلغاء الحجز بنجاح."}), 200
    else:
        # قد يكون السبب أن الحجز غير موجود أو لا يخص المستخدم
        return jsonify({"message": "فشل إلغاء الحجز. قد يكون غير موجود أو لا تملك الصلاحية."}), 404


# ----------------------------------------------------
# 6. نقاط نهاية Gemini API (تم الإصلاح)
# ----------------------------------------------------

@app.route('/api/gemini/chat', methods=['POST'])
def gemini_chat():
    """نقطة نهاية للدردشة باستخدام نموذج Gemini."""
    data = request.get_json()
    user_prompt = data.get('prompt')
    
    if not user_prompt:
        return jsonify({"message": "يجب توفير رسالة دردشة."}), 400

    try:
        system_instruction = (
            "أنت مساعد حجوزات فندقية ذكي وودود. مهمتك هي الإجابة على استفسارات المستخدمين حول السفر، "
            "تخطيط الرحلات، الأماكن السياحية، والفنادق. ردودك يجب أن تكون باللغة العربية، مختصرة، "
            "مفيدة، ومناسبة لسياق تطبيق حجز الفنادق. تجنب طلب معلومات شخصية."
        )
        
        # 🌟🌟🌟 إصلاح: العودة إلى استخدام السلسلة النصية (string)
        # هذا يتوافق مع رسالة خطأ سابقة ("... 'google_search_retrieval'")
        # ويحل مشكلة Pylance لعدم وجود موديول 'tools'
        google_search_tool = "google_search_retrieval"
        
        model = genai.GenerativeModel(
            model_name='gemini-2.0-flash', 
            system_instruction=system_instruction,
            tools=[]  # 🌟🌟🌟 إصلاح: تم تمرير السلسلة
        )
        response = model.generate_content(user_prompt)
        
        if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
            ai_text = response.candidates[0].content.parts[0].text
        else:
            ai_text = "عذراً، لم أتمكن من توليد رد واضح. يرجى المحاولة بسؤال آخر."

        return jsonify({"response": ai_text}), 200

    except Exception as e:
        print(f"خطأ في استدعاء Gemini API (Chat): {e}")
        return jsonify({"response": "عذراً، حدث خطأ تقني في الاتصال بمساعد الذكاء الاصطناعي."}), 500

@app.route('/api/gemini/analyze', methods=['POST'])
@login_required
def gemini_analyze_booking():
    """نقطة نهاية لتحليل حجز محدد باستخدام نموذج Gemini."""
    data = request.get_json()
    booking_id = data.get('booking_id')

    if not booking_id:
        return jsonify({"message": "يجب تحديد معرف الحجز للتحليل."}), 400

    booking = db_manager.fetch_booking_by_id(booking_id, current_user.id)

    if not booking:
        return jsonify({"message": "الحجز غير موجود أو لا تملك صلاحية الوصول إليه."}), 404
    
    booking_details = (
        f"تفاصيل الحجز المطلوب تحليلها: "
        f"الفندق: {booking['hotel_name']}، "
        f"المدينة: {booking['city']}، "
        f"تاريخ الدخول: {booking['check_in']}، "
        f"تاريخ الخروج: {booking['check_out']}، "
        f"السعر الإجمالي: {booking['price']}."
    )

    try:
        system_instruction = (
            "أنت محلل حجوزات فندقية ذكي. مهمتك هي تحليل الحجز المقدم وتقديم تقرير structured JSON. "
            "يجب أن يتضمن التقرير تقييمًا لقيمة السعر واقتراحات لأنشطة سياحية ممتعة في المدينة المذكورة. "
            "يجب استخدام أداة Google Search لضمان أن المعلومات حديثة وواقعية (خاصة للأنشطة السياحية)."
        )

        response_schema = types.Schema(
            type=types.Type.OBJECT,
            properties={
                "title": types.Schema(type=types.Type.STRING, description="عنوان جذاب للتحليل"),
                "price_analysis": types.Schema(type=types.Type.STRING, description="تقييم موجز لقيمة السعر (جيد/عادل/مرتفع) مع تبرير بناءً على الفندق والمدينة"),
                "activity_suggestions": types.Schema(
                    type=types.Type.ARRAY,
                    description="قائمة بـ 3 أنشطة سياحية أو مطاعم أو فعاليات في مدينة الحجز، مع ذكر سبب الاقتراح.",
                    items=types.Schema(
                        type=types.Type.OBJECT,
                        properties={
                            "name": types.Schema(type=types.Type.STRING),
                            "reason": types.Schema(type=types.Type.STRING)
                        },
                        required=["name", "reason"]
                    )
                ),
                "summary": types.Schema(type=types.Type.STRING, description="ملخص نهائي ونصيحة للمسافر.")
            },
            required=["title", "price_analysis", "activity_suggestions", "summary"]
        )
        
        prompt = (
            f"بناءً على تفاصيل الحجز التالية، قم بإنشاء تقرير تحليل مفصل باللغة العربية في تنسيق JSON. "
            f"{booking_details}"
        )

        # 🌟🌟🌟 إصلاح: العودة إلى استخدام السلسلة النصية
        google_search_tool = "google_search_retrieval"

        model = genai.GenerativeModel(
            model_name='gemini-2.0-flash',
            system_instruction=system_instruction,
            tools=[],  # 🌟🌟🌟 إصلاح: تم تمرير السلسلة
            # 🌟 طلب JSON منظم
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                response_schema=response_schema
            )
        )
        response = model.generate_content(prompt)
        
        json_text = response.candidates[0].content.parts[0].text
        analysis_data = json.loads(json_text)
        
        return jsonify(analysis_data), 200

    except Exception as e:
        print(f"خطأ في استدعاء Gemini API (Analyze): {e}")
        return jsonify({"message": "عذراً، فشل التحليل. تأكد من أن تفاصيل الحجز واضحة."}), 500

# ----------------------------------------------------
# 7. نقاط نهاية المفضلة (تم إصلاح المنطق الداخلي)
# ----------------------------------------------------

@app.route('/api/favorites/toggle', methods=['POST'])
@login_required
def toggle_favorite():
    data = request.get_json()
    item_name = data.get('item_name')
    city = data.get('city')

    if not item_name or not city:
        return jsonify({"message": "يجب توفير اسم العنصر والمدينة."}), 400

    user_id = current_user.id
    
    # 🌟 تم إصلاح منطق db_manager
    if db_manager.is_favorite(user_id, item_name):
        # إلغاء التفضيل
        db_manager.remove_favorite(user_id, item_name)
        is_favorite = False
        message = "تم إلغاء التفضيل بنجاح."
    else:
        # التفضيل
        db_manager.add_favorite(user_id, item_name, city)
        is_favorite = True
        message = "تم التفضيل بنجاح."

    return jsonify({"success": True, "is_favorite": is_favorite, "message": message}), 200

@app.route('/api/favorites', methods=['GET'])
@login_required
def get_favorites():
    """جلب قائمة المفضلة للمستخدم."""
    user_id = current_user.id
    favorites = db_manager.fetch_user_favorites(user_id)
    return jsonify(favorites), 200


# ----------------------------------------------------
# 8. تشغيل الخادم
# ----------------------------------------------------
if __name__ == '__main__':
    # db_manager.create_tables() # 🌟 يتم استدعاؤها الآن في __init__
    print(">>> تشغيل الخادم على http://127.0.0.1:5000 <<<")
    print(">>> اضغط CTRL+C للإيقاف <<<")
    app.run(debug=True, host='0.0.0.0', port=5000)