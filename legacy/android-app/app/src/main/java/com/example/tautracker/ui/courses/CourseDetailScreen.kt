package com.example.tautracker.ui.courses

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.tautracker.core.security.SecureStorage
import com.example.tautracker.data.remote.MoodleApi
import com.example.tautracker.domain.usecase.CalculateGradesUseCase
import com.example.tautracker.domain.usecase.CalculatedGrade
import com.example.tautracker.domain.usecase.ExtractZoomLinksUseCase
import com.example.tautracker.domain.usecase.ZoomLink
import com.example.tautracker.data.repository.SyncRepository
import com.example.tautracker.data.local.entity.AssignmentEntity
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CourseDetailScreen(
    courseId: Long,
    syncRepository: SyncRepository,
    moodleApi: MoodleApi,
    secureStorage: SecureStorage,
    onBack: () -> Unit
) {
    val isLoading = remember { mutableStateOf(true) }
    val error = remember { mutableStateOf<String?>(null) }
    val zoomLinks = remember { mutableStateOf<List<ZoomLink>>(emptyList()) }
    val grades = remember { mutableStateOf<List<CalculatedGrade>>(emptyList()) }
    val assignments by syncRepository.getAssignmentsForCourse(courseId).collectAsState(initial = emptyList())
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(courseId) {
        val token = secureStorage.getToken()
        if (token.isNullOrEmpty()) {
            error.value = "Not logged in"
            isLoading.value = false
            return@LaunchedEffect
        }

        try {
            val siteInfo = moodleApi.getSiteInfo(token)
            val userId = siteInfo.userid ?: throw Exception("Invalid user ID")

            val contents = moodleApi.getCourseContents(token, courseId)
            zoomLinks.value = ExtractZoomLinksUseCase().execute(contents)

            val gradesTableResponse = moodleApi.getGradesTable(token, userId, courseId)
            val tableData = gradesTableResponse.tables.firstOrNull()?.tabledata ?: emptyList()
            grades.value = CalculateGradesUseCase().execute(tableData)

        } catch (e: Exception) {
            error.value = e.localizedMessage
        } finally {
            isLoading.value = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Course Details") },
                navigationIcon = {
                    Button(onClick = onBack) {
                        Text("Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        if (isLoading.value) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        } else if (error.value != null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(text = error.value!!, color = MaterialTheme.colorScheme.error)
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(16.dp)
            ) {
                item {
                    Text("Assignments", style = MaterialTheme.typography.titleLarge)
                    Spacer(modifier = Modifier.height(8.dp))
                }
                if (assignments.isEmpty()) {
                    item { Text("No assignments.") }
                } else {
                    items(assignments) { assignment ->
                        Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(assignment.name, style = MaterialTheme.typography.titleMedium)
                                val sdf = SimpleDateFormat("dd/MM/yyyy HH:mm", Locale.getDefault())
                                Text("Due: ${sdf.format(Date(assignment.dueDate * 1000L))}", style = MaterialTheme.typography.bodyMedium)
                                
                                Spacer(modifier = Modifier.height(8.dp))
                                var noteText by remember { mutableStateOf(assignment.notes ?: "") }
                                OutlinedTextField(
                                    value = noteText,
                                    onValueChange = { 
                                        noteText = it
                                        coroutineScope.launch {
                                            syncRepository.updateAssignmentNotes(assignment.id, noteText)
                                        }
                                    },
                                    label = { Text("Notes") },
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                        }
                    }
                }

                item {
                    Spacer(modifier = Modifier.height(24.dp))
                    Text("Zoom Links", style = MaterialTheme.typography.titleLarge)
                    Spacer(modifier = Modifier.height(8.dp))
                }
                if (zoomLinks.value.isEmpty()) {
                    item { Text("No Zoom links found.") }
                } else {
                    items(zoomLinks.value) { link ->
                        Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(link.name, style = MaterialTheme.typography.titleMedium)
                                Text(link.url, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }

                item {
                    Spacer(modifier = Modifier.height(24.dp))
                    Text("Grades", style = MaterialTheme.typography.titleLarge)
                    Spacer(modifier = Modifier.height(8.dp))
                }
                if (grades.value.isEmpty()) {
                    item { Text("No grades available.") }
                } else {
                    items(grades.value) { grade ->
                        Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(grade.assignmentName, style = MaterialTheme.typography.titleMedium)
                                val gradeText = if (grade.isHidden) "Hidden" else "${grade.gradeValue ?: "-"} / ${grade.maxGrade ?: "-"}"
                                Text("Grade: $gradeText", style = MaterialTheme.typography.bodyMedium)
                                grade.percentage?.let {
                                    Text("Percentage: %.2f%%".format(it), style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
