import { test } from '../../../src/fixtures/cms.fixture';
import { scenario } from '../../../src/utils/core/scenario-test';

//========================================================================
// PTL-03 Manage User Profile
// The test cases of "PTL-03 Manage User Profile.xlsx", in the sheet's order. Each case is written as the sheet has it: the scenario text
// is pasted from the sheet's cell (@Priority, Scenario, Given, When, Then, #Arabic) and the code below it does what each
// Given / When / Then says. tests/unit/story-sheets.test.ts keeps this text equal to the sheet.
//========================================================================================

test.describe('PTL-03 Manage User Profile', () => {

  test(...scenario('PTL-03-01', `
    @Priority=1
    Scenario: View profile page with all profile data
    Given the user is logged in as a registered external user
    When the user navigates to the profile page
    Then the profile page displays full name, email, sector, phone number, company name, products, export card number, export card image, commercial registration image, commercial registration number, company address, and company owner name
    #Arabic_Description: عرض صفحة الملف الشخصي بجميع البيانات المسجلة للمستخدم
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-02', `
    @Priority=1
    Scenario: View profile page matches figma design
    Given the user is logged in as a registered external user
    When the user navigates to the profile page
    Then profile page matches figma design
    #Arabic_Description:  صفحة الملف الشخصي تطابق تصميم فيجما
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-03', `
    @Priority=1
    Scenario: Submit a change request when updating full name
    Given the user is on the profile edit page
    When the user updates the full name and submits
    Then the system submits the change as a pending request awaiting administrator approval
    And the info message "Your updates have been submitted for approval." is displayed
    #Arabic_Description: إرسال طلب تعديل عند تغيير الاسم الكامل وعرض رسالة التأكيد
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-04', `
    @Priority=2
    Scenario: Verify that Email, Phone Number, Export Card Number, Export Card Image, Commercial Registration Image, and Commercial Registration Number are displayed as read-only and cannot be modified.
    Given the user is on the profile page
    When the user attempts to edit any of these fields: Email, Phone Number, Export Card Number, Export Card Image, Commercial Registration Image, Commercial Registration Number
    Then the fields should be non-editable (e.g., disabled input, plain text, or no edit control)
    And no save or submit action should be available for these fields
    #Arabic_Description: التحقق من أن حقول البريد الإلكتروني ورقم الهاتف ورقم بطاقة التصدير وصورة بطاقة التصدير وصورة السجل التجاري ورقم السجل التجاري تكون للعرض فقط وغير قابلة للتعديل من قبل المستخدم
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-05', `
    @Priority=1
    Scenario: Submit a change request when updating company name
    Given the user is on the profile edit page
    When the user updates the company name and submits
    Then the system submits the change as a pending request awaiting administrator approval
    And the info message "Your updates have been submitted for approval." is displayed
    #Arabic_Description: إرسال طلب تعديل عند تغيير اسم الشركة
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-06', `
    @Priority=1
    Scenario: Submit a change request when updating company logo
    Given the user is on the profile edit page
    When the user uploads a new company logo and submits
    Then the system submits the change as a pending request awaiting administrator approval
    And the info message "Your updates have been submitted for approval." is displayed
    #Arabic_Description: إرسال طلب تعديل عند تحميل شعار شركة جديد
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-07', `
    @Priority=1
    Scenario: Submit a change request when updating sector
    Given the user is on the profile edit page
    When the user updates the sector and submits
    Then the system submits the change as a pending request awaiting administrator approval
    And the info message "Your updates have been submitted for approval." is displayed
    #Arabic_Description: إرسال طلب تعديل عند تغيير القطاع
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-08', `
    @Priority=1
    Scenario: Submit a change request when updating products
    Given the user is on the profile edit page
    When the user updates the products and submits
    Then the system submits the change as a pending request awaiting administrator approval
    And the info message "Your updates have been submitted for approval." is displayed
    #Arabic_Description: إرسال طلب تعديل عند تحديث المنتجات
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-09', `
    @Priority=1
    Scenario: Submit a change request when updating company address
    Given the user is on the profile edit page
    When the user updates the company address and submits
    Then the system submits the change as a pending request awaiting administrator approval
    And the info message "Your updates have been submitted for approval." is displayed
    #Arabic_Description: إرسال طلب تعديل عند تغيير عنوان الشركة
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-10', `
    @Priority=1
    Scenario: Submit a change request when updating company owner name
    Given the user is on the profile edit page
    When the user updates the company owner name and submits
    Then the system submits the change as a pending request awaiting administrator approval
    And the info message "Your updates have been submitted for approval." is displayed
    #Arabic_Description: إرسال طلب تعديل عند تغيير اسم صاحب الشركة
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-11', `
    @Priority=2
    Scenario: Existing approved data remains active while change request is pending
    Given the user has submitted a change request for a sensitive field such as full name
    When the change request is still pending administrator approval
    Then the previously approved data is still displayed as the active profile data
    #Arabic_Description: استمرار عرض البيانات المعتمدة سابقاً أثناء انتظار الموافقة على طلب التعديل
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-12', `
    @Priority=1
    Scenario: Profile updated successfully after administrator approval
    Given the administrator has approved a pending profile change request
    When the user views the profile page
    Then the updated data is reflected in the profile
    And the success message "Profile updated successfully." is displayed
    #Arabic_Description: تحديث البيانات في الملف الشخصي بعد موافقة المسؤول وعرض رسالة النجاح
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-13', `
    @Priority=2
    Scenario: Upload company logo
    Given the user is on the profile edit page
    When the user uploads a valid company logo image and submits
    Then the company logo upload is included in the pending change request awaiting administrator approval
    #Arabic_Description: رفع شعار الشركة وإرساله ضمن طلب تعديل للموافقة عليه
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-14', `
    @Priority=2
    Scenario: Upload export card image
    Given the user is on the profile edit page
    When the user uploads a valid export card image
    Then the image is saved and displayed in the profile under export card image
    #Arabic_Description: رفع صورة بطاقة التصدير وعرضها في الملف الشخصي
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-15', `
    @Priority=2
    Scenario: Upload commercial registration image
    Given the user is on the profile edit page
    When the user uploads a valid commercial registration image
    Then the image is saved and displayed in the profile under commercial registration image
    #Arabic_Description: رفع صورة السجل التجاري وعرضها في الملف الشخصي
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-16', `
    @Priority=1
    Scenario: View My Submissions widget with summary counts
    Given the user is on the profile page or submissions section
    When the submissions widget loads
    Then the system displays total submissions count, under review count, approved count, and rejected count
    #Arabic_Description: عرض ملخص الطلبات المقدمة مع الأعداد الإجمالية لكل حالة
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-17', `
    @Priority=1
    Scenario: View submissions list with required fields
    Given the user is viewing the submissions section
    When the submissions list loads
    Then each submission displays the submission reference number, submission type, submission date, and status
    #Arabic_Description: عرض قائمة الطلبات المقدمة مع رقم المرجع والنوع والتاريخ والحالة
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-18', `
    @Priority=1
    Scenario: View detailed information of a specific submission
    Given the user is on the submissions list page
    When the user clicks on a specific submission
    Then the system displays the submission details including submission reference number, opportunity title or contact us classification, submission date, and current status
    #Arabic_Description: عرض التفاصيل الكاملة لطلب محدد عند الضغط عليه
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-19', `
    @Priority=2
    Scenario: View rejection details when submission is rejected
    Given the user is viewing a specific submission that has been rejected
    When the submission details page loads
    Then the system displays the rejection date and rejection reason if applicable
    #Arabic_Description: عرض تاريخ الرفض وسبب الرفض عند اختيار طلب بحالة "مرفوض"
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-20', `
    @Priority=2
    Scenario: View submission with status Pending
    Given the user has a submission that is still under review
    When the user views that submission in the list or details page
    Then the status is displayed as "Pending Requests"
    #Arabic_Description: عرض حالة "قيد المراجعة" للطلبات التي لم يتم البت فيها بعد
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-21', `
    @Priority=2
    Scenario: View submission with status Approved
    Given the user has a submission that has been approved
    When the user views that submission
    Then the status is displayed as "Approved"
    #Arabic_Description: عرض حالة "مقبول" للطلبات التي تمت الموافقة عليها
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-22', `
    @Priority=2
    Scenario: View submission with status Rejected
    Given the user has a submission that has been rejected
    When the user views that submission
    Then the status is displayed as "Rejected" along with the rejection date and reason if available
    #Arabic_Description: عرض حالة "مرفوض" مع تاريخ الرفض والسبب إن وجد
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-23', `
    @Priority=2
    Scenario: View submission with status Rejected
    Given the user has a submission that has been rejected
    When the user views that submission
    Then the status is displayed as "Rejected" along with the rejection date and reason if available
    #Arabic_Description: عرض حالة "مرفوض" مع تاريخ الرفض والسبب إن وجد
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-24', `
    @Priority=2
    Scenario: Filter submissions by date range
    Given the user is on the submissions list page
    When the user applies a date range filter
    Then only submissions within the selected date range are displayed
    #Arabic_Description: تصفية قائمة الطلبات حسب نطاق تاريخ محدد
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-25', `
    @Priority=2
    Scenario: Filter submissions by status
    Given the user is on the submissions list page
    When the user selects a specific status filter such as Approved, Rejected, or Pending
    Then only submissions matching the selected status are displayed
    #Arabic_Description: تصفية الطلبات حسب الحالة (مقبول، مرفوض، قيد المراجعة)
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-26', `
    @Priority=2
    Scenario: Search submissions by reference number
    Given the user is on the submissions list page
    When the user enters a valid submission reference number in the search field
    Then the matching submission is displayed in the results
    #Arabic_Description: البحث في الطلبات باستخدام رقم المرجع
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-27', `
    @Priority=2
    Scenario: Search submissions by title
    Given the user is on the submissions list page
    When the user enters a valid title keyword in the search field
    Then all submissions matching that title keyword are displayed
    #Arabic_Description: البحث في الطلبات باستخدام العنوان
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-28', `
    @Priority=2
    Scenario: Search submissions with no matching results
    Given the user is on the submissions list page
    When the user searches with a reference number or title that does not match any submission
    Then the system displays a no results found message
    #Arabic_Description: عرض رسالة عدم وجود نتائج عند البحث بمرجع أو عنوان غير موجود
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-29', `
    @Priority=2
    Scenario: User cannot bypass change request approval by re-submitting the same field
    Given the user has a pending change request for the full name field
    When the user attempts to submit another update to the full name before the first is resolved
    Then the system handles the duplicate submission appropriately by either blocking or queuing it
    #Arabic_Description: منع المستخدم من إرسال طلب تعديل مكرر لنفس الحقل قبل البت في الطلب الأول
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-30', `
    @Priority=3
    Scenario: Profile page is responsive on mobile device
    Given the user is accessing the profile page on a mobile device
    When the profile page loads
    Then all profile fields, edit options, and submission history are displayed correctly on the mobile screen
    #Arabic_Description: التحقق من استجابة صفحة الملف الشخصي على الأجهزة المحمولة
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });

  test(...scenario('PTL-03-31', `
    @Priority=1
    Scenario: Verify that the user can download a submission copy as PDF
    Given The user is logged in
    And The user has completed and submitted the form
    When The user clicks on the "Download PDF" button
    Then The system generates and downloads a PDF copy of the submission
    #Arabic: التحقق من أن المستخدم يمكنه تنزيل نسخة من الإرسال بصيغة PDF
  `), async () => {
    test.fixme(true, 'Not automated yet');
  });
});
